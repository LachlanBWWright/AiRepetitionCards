using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Recall.Api.Contracts;

namespace Recall.Api.Features.Auth;

/// <summary>Supabase browser authentication routes. Sessions use the same chunked SSR cookie format as Next.</summary>
public static partial class AuthEndpoints
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5)
    })
    { Timeout = TimeSpan.FromSeconds(10) };

    public static IEndpointRouteBuilder MapAuthEndpoints(
        this IEndpointRouteBuilder endpoints,
        string? projectUrl,
        string? publishableKey,
        bool secureCookies = true)
    {
        endpoints.MapGet("/api/v1/auth/session", async (HttpContext context, CancellationToken token) =>
        {
            SetPrivateHeaders(context.Response);
            var config = SupabaseConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
            if (config is null)
                return Results.Json(new { error = "not-configured" }, statusCode: StatusCodes.Status503ServiceUnavailable);

            var expectedOwner = context.Request.Headers["x-recall-workspace-owner"];
            if (expectedOwner.Count > 1 || (expectedOwner.Count == 1 && !IsWorkspaceOwner(expectedOwner[0])))
                return Results.Json(new { error = "workspace-account-changed" }, statusCode: StatusCodes.Status409Conflict);

            var authorization = context.Request.Headers.Authorization.ToString();
            var bearerMatch = System.Text.RegularExpressions.Regex.Match(authorization,
                "^Bearer\\s+(\\S+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase |
                System.Text.RegularExpressions.RegexOptions.CultureInvariant);
            var bearer = bearerMatch.Success ? bearerMatch.Groups[1].Value : null;
            if (!string.IsNullOrEmpty(authorization) && string.IsNullOrEmpty(bearer)) return AnonymousSession();
            var sessionResult = bearer is null
                ? await ReadSessionAsync(context, config, token)
                : new SessionReadResult(new SessionEnvelope(bearer, null, null, null, "bearer", null), false);
            if (sessionResult.Unavailable)
                return Results.Json(new { error = "session-unavailable" }, statusCode: StatusCodes.Status502BadGateway);
            var session = sessionResult.Session;
            if (session?.AccessToken is not { Length: > 0 } accessToken) return AnonymousSession();
            var lookup = await GetSessionUserAsync(config, accessToken, token);
            if (lookup.Unavailable)
                return Results.Json(new { error = "session-unavailable" }, statusCode: StatusCodes.Status502BadGateway);
            var user = lookup.User;
            if (user is null) return AnonymousSession();
            if (!Guid.TryParse(user.Id, out var userId))
                return Results.Json(new { error = "session-unavailable" }, statusCode: StatusCodes.Status502BadGateway);
            if (expectedOwner.Count == 1 && !string.Equals(expectedOwner[0], userId.ToString("D"), StringComparison.OrdinalIgnoreCase))
                return Results.Json(new { error = "workspace-account-changed" }, statusCode: StatusCodes.Status409Conflict);
            var email = user.Email?.Trim();
            var internalIdentity = email?.EndsWith("@identity.recall.invalid", StringComparison.OrdinalIgnoreCase) == true;
            var displayLabel = !string.IsNullOrWhiteSpace(email) && !internalIdentity
                ? email
                : !string.IsNullOrWhiteSpace(user.Metadata?.Name)
                    ? user.Metadata.Name.Trim()[..Math.Min(user.Metadata.Name.Trim().Length, 320)]
                    : internalIdentity ? "ChatGPT account" : "Recall account";
            return SessionResponse(new AuthSessionResponse(1, true, displayLabel, userId));
        }).AllowAnonymous().WithName("GetAuthSession").WithTags("Authentication");

        endpoints.MapGet("/auth/confirm", async (HttpContext context, CancellationToken token) =>
        {
            SetPrivateHeaders(context.Response);
            var returnValues = context.Request.Query["next"];
            var returnPath = SharedReturnPath(returnValues.Count == 1 ? returnValues[0] : null);
            var hashValues = context.Request.Query["token_hash"];
            var typeValues = context.Request.Query["type"];
            var hash = hashValues.Count > 0 ? hashValues[0] ?? string.Empty : string.Empty;
            var type = typeValues.Count > 0 ? typeValues[0] ?? string.Empty : string.Empty;
            var config = SupabaseConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
            if (config is null) return SignInRedirect(context, "provider-not-configured", returnPath);
            if (type != "email" || hash.Length is < 1 or > 4096)
                return SignInRedirect(context, "invalid-link", returnPath);

            var verified = await SendAsync<SessionEnvelope>(config, HttpMethod.Post, "/auth/v1/verify", token,
                new { token_hash = hash, type });
            if (verified is null || verified.AccessToken is null || verified.User is null)
                return SignInRedirect(context, "link-expired", returnPath);
            WriteSessionCookies(context, config, verified);
            return Results.Redirect(returnPath, permanent: false, preserveMethod: false);
        }).AllowAnonymous().WithName("ConfirmEmailSignIn").WithTags("Authentication");

        endpoints.MapPost("/auth/sign-out", async (HttpContext context, CancellationToken token) =>
        {
            SetPrivateHeaders(context.Response);
            if (!SameOrigin(context.Request)) return Results.Json(new { error = "invalid-origin" }, statusCode: 403);
            var config = SupabaseConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
            var destination = "/";
            if (config is not null)
            {
                var sessionResult = await ReadCookieSessionOrCurrentBearerAsync(context, config, token);
                var session = sessionResult.Session;
                if (session is not null)
                    if (!await RevokeLocalSessionAsync(config, session.AccessToken ?? string.Empty, token))
                        destination = "/sign-in";
                ClearSessionCookies(context, config);
            }
            context.Response.Headers.Location = destination;
            return Results.StatusCode(StatusCodes.Status303SeeOther);
        }).AllowAnonymous().WithName("SignOut").WithTags("Authentication");

        MapOpenAiSignInEndpoints(endpoints, projectUrl, publishableKey, secureCookies);
        return endpoints;
    }

    /// <summary>Best-effort local revocation after an account has been erased, then always expires every SSR cookie chunk.</summary>
    internal static async Task SignOutAfterAccountDeletionAsync(
        HttpContext context,
        Uri projectUrl,
        string publishableKey,
        string accessToken,
        bool secureCookies)
    {
        var config = SupabaseConfiguration.TryCreate(projectUrl.AbsoluteUri, publishableKey, secureCookies);
        if (config is null) return;

        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            _ = await SendAsync<JsonElement>(config, HttpMethod.Post, "/auth/v1/logout?scope=local",
                timeout.Token, accessToken: accessToken, allowEmpty: true);
        }
        catch (OperationCanceledException)
        {
            // Revocation is best-effort after the identity has already been deleted.
        }
        finally
        {
            ClearSessionCookies(context, config);
        }
    }

    private static IResult AnonymousSession() => SessionResponse(new AuthSessionResponse(1, false, null, null));

    private static IResult SessionResponse(AuthSessionResponse response)
    {
        var value = JsonSerializer.SerializeToElement(response, JsonOptions);
        return ContractBoundaryValidator.ValidateAuthSession(value).IsValid
            ? Results.Json(value)
            : Results.Problem(statusCode: StatusCodes.Status502BadGateway, title: "session-unavailable");
    }

    private static async Task<SessionReadResult> ReadSessionAsync(HttpContext context, SupabaseConfiguration config, CancellationToken token)
    {
        var raw = ReadCookie(context.Request, config.CookieName);
        if (raw is null) return SessionReadResult.Anonymous;
        var session = DecodeSession(raw);
        if (session is null)
        {
            ClearSessionCookies(context, config);
            return SessionReadResult.Anonymous;
        }
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (session.ExpiresAt > now + 30) return new(session, false);
        if (string.IsNullOrWhiteSpace(session.RefreshToken))
        {
            ClearSessionCookies(context, config);
            return SessionReadResult.Anonymous;
        }
        var refreshed = await RefreshSessionAsync(config, session.RefreshToken, token);
        if (refreshed.Unavailable) return SessionReadResult.ProviderUnavailable;
        if (refreshed.Session is null)
        {
            ClearSessionCookies(context, config);
            return SessionReadResult.Anonymous;
        }
        WriteSessionCookies(context, config, refreshed.Session);
        return new(refreshed.Session, false);
    }

    private static Task<SessionReadResult> ReadCookieSessionOrCurrentBearerAsync(
        HttpContext context, SupabaseConfiguration config, CancellationToken token)
    {
        if (context.Items.ContainsKey(SupabaseSsrBearerMiddleware.CookieSessionRequestItem) &&
            context.Request.Headers.Authorization.ToString() is { } authorization &&
            authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) &&
            authorization[7..].Trim() is { Length: > 0 } accessToken)
            return Task.FromResult(new SessionReadResult(new SessionEnvelope(accessToken, null, null, null, "bearer", null), false));
        return ReadSessionAsync(context, config, token);
    }

    private static bool IsWorkspaceOwner(string? value) =>
        value is not null && System.Text.RegularExpressions.Regex.IsMatch(value,
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private static async Task<SessionReadResult> RefreshSessionAsync(
        SupabaseConfiguration config,
        string refreshToken,
        CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post,
                new Uri(config.Url, "/auth/v1/token?grant_type=refresh_token"));
            request.Headers.TryAddWithoutValidation("apikey", config.PublishableKey);
            request.Content = JsonContent.Create(new { refresh_token = refreshToken });
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return SessionReadResult.Anonymous;
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > 65_536)
                return SessionReadResult.ProviderUnavailable;
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            if (json.Length is 0 or > 65_536) return SessionReadResult.ProviderUnavailable;
            var session = JsonSerializer.Deserialize<SessionEnvelope>(json, JsonOptions);
            return session is { AccessToken.Length: > 0, RefreshToken.Length: > 0 }
                ? new(session, false)
                : SessionReadResult.ProviderUnavailable;
        }
        catch (HttpRequestException) { return SessionReadResult.ProviderUnavailable; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return SessionReadResult.ProviderUnavailable; }
        catch (JsonException) { return SessionReadResult.ProviderUnavailable; }
        catch (IOException) { return SessionReadResult.ProviderUnavailable; }
    }

    private static async Task<UserEnvelope?> GetUserAsync(SupabaseConfiguration config, string accessToken, CancellationToken token)
    {
        var response = await SendAsync<UserEnvelope>(config, HttpMethod.Get, "/auth/v1/user", token,
            accessToken: accessToken);
        return response is { Id.Length: > 0 } ? response : null;
    }

    private static async Task<SessionUserLookup> GetSessionUserAsync(
        SupabaseConfiguration config,
        string accessToken,
        CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(config.Url, "/auth/v1/user"));
            request.Headers.TryAddWithoutValidation("apikey", config.PublishableKey);
            request.Headers.Authorization = new("Bearer", accessToken);
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return new(null, false);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > 65_536)
                return new(null, true);
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            if (json.Length is 0 or > 65_536) return new(null, true);
            var user = JsonSerializer.Deserialize<UserEnvelope>(json, JsonOptions);
            return user is { Id.Length: > 0 } ? new(user, false) : new(null, true);
        }
        catch (HttpRequestException) { return new(null, true); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return new(null, true); }
        catch (JsonException) { return new(null, true); }
        catch (IOException) { return new(null, true); }
    }

    private static async Task<T?> SendAsync<T>(SupabaseConfiguration config, HttpMethod method, string path,
        CancellationToken cancellationToken, object? body = null, string? accessToken = null, bool allowEmpty = false)
    {
        try
        {
            using var request = new HttpRequestMessage(method, new Uri(config.Url, path));
            request.Headers.TryAddWithoutValidation("apikey", config.PublishableKey);
            if (!string.IsNullOrWhiteSpace(accessToken)) request.Headers.Authorization = new("Bearer", accessToken);
            if (body is not null) request.Content = JsonContent.Create(body);
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (allowEmpty && response.StatusCode == HttpStatusCode.NoContent) return default;
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > 65_536) return default;
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            if (json.Length > 65_536 || json.Length == 0) return default;
            return JsonSerializer.Deserialize<T>(json, JsonOptions);
        }
        catch (HttpRequestException) { return default; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return default; }
        catch (JsonException) { return default; }
        catch (IOException) { return default; }
    }

    private static async Task<bool> RevokeLocalSessionAsync(
        SupabaseConfiguration config,
        string accessToken,
        CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(config.Url, "/auth/v1/logout?scope=local"));
            request.Headers.TryAddWithoutValidation("apikey", config.PublishableKey);
            request.Headers.Authorization = new("Bearer", accessToken);
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return false; }
    }

    private static string? ReadCookie(HttpRequest request, string baseName)
    {
        var exact = request.Cookies[baseName];
        if (exact is not null) return exact;
        var chunks = request.Cookies
            .Where(pair => pair.Key.StartsWith(baseName + ".", StringComparison.Ordinal))
            .Select(pair =>
            {
                var suffix = pair.Key[(baseName.Length + 1)..];
                var validIndex = int.TryParse(suffix, out var index) && index >= 0;
                return (Name: pair.Key, pair.Value, validIndex, Index: validIndex ? index : -1);
            })
            .OrderBy(pair => pair.Index)
            .ToArray();
        if (chunks.Length == 0 || chunks.Any(chunk => !chunk.validIndex) ||
            chunks.Select(chunk => chunk.Index).Distinct().Count() != chunks.Length || chunks[0].Index != 0) return null;
        var length = 0;
        for (var index = 0; index < chunks.Length; index++)
        {
            if (chunks[index].Index != index) return null;
            length += chunks[index].Value.Length;
            if (length > 65_536) return null;
        }
        return string.Concat(chunks.Select(chunk => chunk.Value));
    }

    private static SessionEnvelope? DecodeSession(string value)
    {
        try
        {
            var encoded = value.StartsWith("base64-", StringComparison.Ordinal) ? value[7..] : value;
            if (encoded.Length > 65_536) return null;
            var json = value.StartsWith("base64-", StringComparison.Ordinal)
                ? Encoding.UTF8.GetString(DecodeBase64Url(encoded))
                : encoded;
            var session = JsonSerializer.Deserialize<SessionEnvelope>(json, JsonOptions);
            if (session is not { AccessToken.Length: > 0 } || session.AccessToken.Length >= 32_768) return null;
            return session.ExpiresAt is null && session.ExpiresIn is > 0
                ? session with { ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + session.ExpiresIn.Value }
                : session;
        }
        catch (FormatException) { return null; }
        catch (JsonException) { return null; }
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var standard = value.Replace('-', '+').Replace('_', '/');
        standard += new string('=', (4 - standard.Length % 4) % 4);
        return Convert.FromBase64String(standard);
    }

    private static void WriteSessionCookies(HttpContext context, SupabaseConfiguration config, SessionEnvelope session)
    {
        var value = "base64-" + Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(session, JsonOptions)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        ClearSessionCookies(context, config);
        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = config.SecureCookies,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            IsEssential = true,
            Expires = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(session.ExpiresIn ?? 3600, 60, 31_536_000))
        };
        const int chunkSize = 3000;
        if (value.Length <= chunkSize)
        {
            context.Response.Cookies.Append(config.CookieName, value, options);
            return;
        }
        var chunk = 0;
        for (var offset = 0; offset < value.Length; offset += chunkSize)
            context.Response.Cookies.Append($"{config.CookieName}.{chunk++}", value.Substring(offset, Math.Min(chunkSize, value.Length - offset)), options);
    }

    private static void ClearSessionCookies(HttpContext context, SupabaseConfiguration config)
    {
        var names = context.Request.Cookies.Keys
            .Concat(context.Response.Headers.SetCookie.Select(value => value?.Split(';', 2)[0].Split('=', 2)[0]).OfType<string>())
            .Where(name => name == config.CookieName || name.StartsWith(config.CookieName + ".", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal);
        foreach (var name in names)
            context.Response.Cookies.Delete(name, new CookieOptions { Path = "/", Secure = config.SecureCookies, HttpOnly = true, SameSite = SameSiteMode.Lax });
    }

    private static IResult SignInRedirect(HttpContext context, string status, string returnPath)
    {
        var query = new List<string> { "status=" + Uri.EscapeDataString(status) };
        if (returnPath != "/") query.Add("next=" + Uri.EscapeDataString(returnPath));
        return Results.Redirect("/sign-in?" + string.Join('&', query));
    }

    private static bool SameOrigin(HttpRequest request)
    {
        var origin = request.Headers.Origin.ToString();
        return Uri.TryCreate(origin, UriKind.Absolute, out var parsed) &&
            string.IsNullOrEmpty(parsed.UserInfo) && parsed.AbsolutePath == "/" &&
            string.IsNullOrEmpty(parsed.Query) && string.IsNullOrEmpty(parsed.Fragment) &&
            Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out var requestOrigin) &&
            string.Equals(origin, requestOrigin.GetLeftPart(UriPartial.Authority), StringComparison.Ordinal) &&
            string.Equals(parsed.GetLeftPart(UriPartial.Authority),
                requestOrigin.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);
    }

    private static void SetPrivateHeaders(HttpResponse response)
    {
        response.Headers.CacheControl = "private, no-store";
        response.Headers.Pragma = "no-cache";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers.Vary = "Authorization, Cookie";
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record SupabaseConfiguration(Uri Url, string PublishableKey, string CookieName, bool SecureCookies)
    {
        public static SupabaseConfiguration? TryCreate(string? url, string? key, bool secureCookies)
        {
            var normalizedKey = key?.Trim();
            if (string.IsNullOrWhiteSpace(normalizedKey) || !Uri.TryCreate(url?.Trim(), UriKind.Absolute, out var parsed) ||
                parsed.Scheme is not ("https" or "http") || !string.IsNullOrEmpty(parsed.UserInfo) ||
                !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment)) return null;
            var project = parsed.Host.Split('.', StringSplitOptions.RemoveEmptyEntries)[0];
            if (project.Length is < 1 or > 63 || project.Any(ch => !char.IsAsciiLetterOrDigit(ch) && ch != '-')) return null;
            return new(parsed, normalizedKey, $"sb-{project}-auth-token", secureCookies);
        }
    }

    private sealed record SessionEnvelope(
        [property: JsonPropertyName("access_token")] string? AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] int? ExpiresIn,
        [property: JsonPropertyName("expires_at")] long? ExpiresAt,
        [property: JsonPropertyName("token_type")] string? TokenType,
        [property: JsonPropertyName("user")] UserEnvelope? User);

    private sealed record UserEnvelope(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("email")] string? Email,
        [property: JsonPropertyName("user_metadata")] UserMetadata? Metadata);

    private sealed record UserMetadata([property: JsonPropertyName("name")] string? Name);
    private sealed record SessionUserLookup(UserEnvelope? User, bool Unavailable);
    private sealed record SessionReadResult(SessionEnvelope? Session, bool Unavailable)
    {
        public static SessionReadResult Anonymous { get; } = new(null, false);
        public static SessionReadResult ProviderUnavailable { get; } = new(null, true);
    }
    private sealed record AuthSessionResponse(int SchemaVersion, bool Authenticated, string? DisplayLabel, Guid? OwnerId);
}
