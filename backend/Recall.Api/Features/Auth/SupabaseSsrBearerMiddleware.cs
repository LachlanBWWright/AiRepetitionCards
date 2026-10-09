using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Hosting;

namespace Recall.Api.Features.Auth;

/// <summary>
/// Makes the access token in a Supabase SSR cookie available to ASP.NET's existing JWT bearer
/// authentication handler. The middleware never treats the cookie itself as authenticated; the
/// configured bearer handler must validate the resulting token on the request.
/// </summary>
public sealed class SupabaseSsrBearerMiddleware
{
    public const string CookieSessionRequestItem = "Recall.SupabaseSsrCookieSession";
    private const int MaxCookieValueLength = 65_536;
    private const int CookieChunkSize = 3000;
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5)
    });
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly RequestDelegate _next;
    private readonly SupabaseCookieConfiguration? _configuration;

    public SupabaseSsrBearerMiddleware(RequestDelegate next, IConfiguration configuration, IWebHostEnvironment environment)
    {
        _next = next;
        var projectUrl = configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"];
        var publishableKey = configuration["SUPABASE_PUBLISHABLE_KEY"] ?? configuration["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
        var secureCookies = environment.IsProduction();
        _configuration = SupabaseCookieConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Explicit API credentials retain their existing behavior and are never replaced by a cookie.
        if (_configuration is null || context.Request.Headers.ContainsKey("Authorization"))
        {
            await _next(context);
            return;
        }

        var raw = ReadChunkedCookie(context.Request, _configuration.CookieName);
        var session = raw is null ? null : DecodeSession(raw);
        if (session?.AccessToken is { Length: > 0 } accessToken)
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (session.ExpiresAt is null && session.ExpiresIn is > 0)
                session = session with { ExpiresAt = now + session.ExpiresIn.Value };

            if (session.ExpiresAt is > 0 && session.ExpiresAt > now + 30)
            {
                context.Items[CookieSessionRequestItem] = true;
                context.Request.Headers.Authorization = $"Bearer {accessToken}";
            }
            else if (session.RefreshToken is { Length: > 0 } refreshToken)
            {
                var refreshed = await RefreshAsync(context, _configuration, refreshToken);
                if (refreshed?.AccessToken is { Length: > 0 } newAccessToken &&
                    refreshed.RefreshToken is { Length: > 0 })
                {
                    WriteSessionCookies(context, _configuration, refreshed);
                    context.Items[CookieSessionRequestItem] = true;
                    context.Request.Headers.Authorization = $"Bearer {newAccessToken}";
                }
            }
        }

        await _next(context);
    }

    private static string? ReadChunkedCookie(HttpRequest request, string baseName)
    {
        if (request.Cookies.TryGetValue(baseName, out var unchunked)) return unchunked;

        var chunks = request.Cookies
            .Where(cookie => cookie.Key.StartsWith(baseName + ".", StringComparison.Ordinal))
            .Select(cookie =>
            {
                var suffix = cookie.Key[(baseName.Length + 1)..];
                return (Suffix: suffix, Value: cookie.Value,
                    IsIndex: int.TryParse(suffix, out var index) && index >= 0, Index: index);
            })
            .ToArray();
        if (chunks.Length == 0 || chunks.Any(chunk => !chunk.IsIndex) ||
            chunks.Select(chunk => chunk.Index).Distinct().Count() != chunks.Length) return null;

        var ordered = chunks.OrderBy(chunk => chunk.Index).ToArray();
        if (ordered[0].Index != 0) return null;
        var totalLength = 0;
        for (var index = 0; index < ordered.Length; index++)
        {
            if (ordered[index].Index != index) return null;
            totalLength += ordered[index].Value.Length;
            if (totalLength > MaxCookieValueLength) return null;
        }
        return string.Concat(ordered.Select(chunk => chunk.Value));
    }

    private static SessionEnvelope? DecodeSession(string value)
    {
        try
        {
            if (value.Length > MaxCookieValueLength) return null;
            var json = value.StartsWith("base64-", StringComparison.Ordinal)
                ? Encoding.UTF8.GetString(DecodeBase64Url(value[7..]))
                : value;
            var session = JsonSerializer.Deserialize<SessionEnvelope>(json, JsonOptions);
            if (session?.AccessToken is not { Length: > 0 and < 32_768 }) return null;
            return session;
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

    private static async Task<SessionEnvelope?> RefreshAsync(
        HttpContext context,
        SupabaseCookieConfiguration configuration,
        string refreshToken)
    {
        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                new Uri(configuration.Url, "/auth/v1/token?grant_type=refresh_token"));
            request.Headers.TryAddWithoutValidation("apikey", configuration.PublishableKey);
            request.Content = JsonContent.Create(new { refresh_token = refreshToken });
            using var response = await Http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                context.RequestAborted);
            if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength is > MaxCookieValueLength)
                return null;

            await using var stream = await response.Content.ReadAsStreamAsync(context.RequestAborted);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            while (true)
            {
                var read = await stream.ReadAsync(chunk, context.RequestAborted);
                if (read == 0) break;
                if (buffer.Length + read > MaxCookieValueLength) return null;
                buffer.Write(chunk, 0, read);
            }
            return JsonSerializer.Deserialize<SessionEnvelope>(buffer.ToArray(), JsonOptions);
        }
        catch (HttpRequestException) { return null; }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private static void WriteSessionCookies(
        HttpContext context,
        SupabaseCookieConfiguration configuration,
        SessionEnvelope session)
    {
        var serialized = JsonSerializer.Serialize(session, JsonOptions);
        var value = "base64-" + Convert.ToBase64String(Encoding.UTF8.GetBytes(serialized))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        ClearSessionCookies(context, configuration);
        var cookieOptions = new CookieOptions
        {
            HttpOnly = true,
            Secure = configuration.SecureCookies,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            IsEssential = true,
            Expires = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(session.ExpiresIn ?? 3600, 60, 31_536_000))
        };
        if (value.Length <= CookieChunkSize)
        {
            context.Response.Cookies.Append(configuration.CookieName, value, cookieOptions);
            return;
        }

        var chunkIndex = 0;
        for (var offset = 0; offset < value.Length; offset += CookieChunkSize)
        {
            var part = value.Substring(offset, Math.Min(CookieChunkSize, value.Length - offset));
            context.Response.Cookies.Append($"{configuration.CookieName}.{chunkIndex++}", part, cookieOptions);
        }
    }

    private static void ClearSessionCookies(HttpContext context, SupabaseCookieConfiguration configuration)
    {
        foreach (var name in context.Request.Cookies.Keys.Where(name =>
                     name == configuration.CookieName ||
                     name.StartsWith(configuration.CookieName + ".", StringComparison.Ordinal)))
        {
            context.Response.Cookies.Delete(name, new CookieOptions
            {
                Path = "/",
                Secure = configuration.SecureCookies,
                HttpOnly = true,
                SameSite = SameSiteMode.Lax
            });
        }
    }

    private sealed record SupabaseCookieConfiguration(
        Uri Url,
        string PublishableKey,
        string CookieName,
        bool SecureCookies)
    {
        public static SupabaseCookieConfiguration? TryCreate(string? projectUrl, string? key, bool secureCookies)
        {
            if (string.IsNullOrWhiteSpace(key) ||
                !Uri.TryCreate(projectUrl, UriKind.Absolute, out var url) ||
                url.Scheme is not ("https" or "http") ||
                !string.IsNullOrEmpty(url.UserInfo) ||
                !string.IsNullOrEmpty(url.Query) ||
                !string.IsNullOrEmpty(url.Fragment)) return null;

            var project = url.Host.Split('.', StringSplitOptions.RemoveEmptyEntries)[0];
            if (project.Length is < 1 or > 63 ||
                project.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-')) return null;
            return new(url, key, $"sb-{project}-auth-token", secureCookies);
        }
    }

    private sealed record SessionEnvelope(
        [property: JsonPropertyName("access_token")] string? AccessToken,
        [property: JsonPropertyName("refresh_token")] string? RefreshToken,
        [property: JsonPropertyName("expires_in")] int? ExpiresIn,
        [property: JsonPropertyName("expires_at")] long? ExpiresAt,
        [property: JsonPropertyName("token_type")] string? TokenType,
        [property: JsonPropertyName("user")] JsonElement? User);
}

/// <summary>Application builder registration for the Supabase SSR cookie converter.</summary>
public static class SupabaseSsrBearerApplicationBuilderExtensions
{
    /// <summary>Call before UseAuthentication and before rate limiting.</summary>
    public static IApplicationBuilder UseSupabaseSsrBearer(this IApplicationBuilder app) =>
        app.UseMiddleware<SupabaseSsrBearerMiddleware>();
}
