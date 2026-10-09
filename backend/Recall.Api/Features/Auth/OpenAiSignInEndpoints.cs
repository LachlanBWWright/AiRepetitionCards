using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Text.Encodings.Web;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using NSec.Cryptography;

namespace Recall.Api.Features.Auth;

public static partial class AuthEndpoints
{
    private const string OpenAiIssuer = "https://auth.openai.com";
    private const string OpenAiDiscovery = OpenAiIssuer + "/.well-known/openid-configuration";
    private static readonly string[] OpenAiAlgorithms =
    [
        "EdDSA", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512",
        "ES256", "ES384", "ES512"
    ];
    private static readonly HttpClient OpenAiHttp = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        PooledConnectionLifetime = TimeSpan.FromMinutes(5)
    })
    { Timeout = TimeSpan.FromSeconds(10) };

    private static void MapOpenAiSignInEndpoints(
        IEndpointRouteBuilder endpoints,
        string? projectUrl,
        string? publishableKey,
        bool secureCookies)
    {
        endpoints.MapGet("/api/v1/auth/openai/capabilities", (HttpContext context) =>
        {
            SetPrivateHeaders(context.Response);
            var enabled = OpenAiConfiguration.TryCreate(projectUrl, publishableKey, secureCookies) is not null;
            context.Response.Headers.Vary = "Authorization, Cookie";
            return Results.Json(new { enabled, linkingAvailable = enabled });
        }).AllowAnonymous().WithName("GetOpenAiSignInCapabilities").WithTags("Authentication");

        endpoints.MapGet("/auth/openai", async (HttpContext context, CancellationToken token) =>
        {
            SetPrivateHeaders(context.Response);
            var config = OpenAiConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
            var next = SharedReturnPath(context.Request.Query["next"]);
            var fail = (string reason) => OpenAiRedirect(context, reason, next, config?.Origin);
            ClearOpenAiTransactionCookie(context, config?.SecureCookie ?? secureCookies);
            if (config is null) return fail("unavailable");
            if (!RequestMatchesOrigin(context.Request, config.Origin)) return fail("failed");
            var modes = context.Request.Query["mode"];
            if (modes.Count > 1 || (modes.Count == 1 && modes[0] != "link")) return fail("failed");
            var mode = modes.Count == 1 ? "link" : "sign-in";
            string? linkedUserId = null;
            if (mode == "link")
            {
                var existing = await ReadCookieSessionOrCurrentBearerAsync(context, config.Supabase, token);
                if (existing.Unavailable) return fail("temporarily-unavailable");
                if (existing.Session?.AccessToken is not { Length: > 0 } accessToken) return fail("sign-in-required");
                var userLookup = await GetSessionUserAsync(config.Supabase, accessToken, token);
                if (userLookup.Unavailable) return fail("temporarily-unavailable");
                if (userLookup.User is not { } user || !Guid.TryParse(user.Id, out var id)) return fail("sign-in-required");
                linkedUserId = id.ToString("D").ToLowerInvariant();
            }

            var browserId = RandomBase64Url(32);
            var verifier = RandomBase64Url(32);
            var transaction = new OpenAiTransaction(
                RandomBase64Url(32), RandomBase64Url(32), verifier,
                Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))), config.RedirectUri,
                mode, linkedUserId, next, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            var discovery = await DiscoverAsync(config.Provider, token);
            if (discovery.Discovery is null) return fail("temporarily-unavailable");
            var authorization = await AuthorizationUrl(discovery.Discovery.AuthorizationEndpoint, config.Provider.ClientId, transaction);
            var store = new OpenAiStore(config.Store);
            if (!await store.CreateTransactionAsync(browserId, transaction, token)) return fail("temporarily-unavailable");
            context.Response.Cookies.Append(config.CookieName, browserId, new CookieOptions
            {
                HttpOnly = true,
                Secure = config.SecureCookie,
                SameSite = SameSiteMode.Lax,
                Path = "/",
                IsEssential = true,
                MaxAge = TimeSpan.FromMinutes(10)
            });
            context.Response.Headers["Referrer-Policy"] = "no-referrer";
            return Results.Redirect(authorization);
        }).AllowAnonymous().WithName("OpenAiSignInStart").WithTags("Authentication");

        endpoints.MapGet("/auth/openai/callback", async (HttpContext context, CancellationToken token) =>
        {
            SetPrivateHeaders(context.Response);
            var config = OpenAiConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
            var browserId = config is null ? null : context.Request.Cookies[config.CookieName];
            ClearOpenAiTransactionCookie(context, config?.SecureCookie ?? secureCookies);
            var next = "/";
            var fail = (string reason) => OpenAiRedirect(context, reason, next, config?.Origin);
            if (config is null) return fail("unavailable");
            if (!RequestMatchesOrigin(context.Request, config.Origin)) return fail("failed");
            if (browserId is null || !IsRandomToken(browserId, 43)) return fail("expired");
            var store = new OpenAiStore(config.Store);
            var transaction = await store.ConsumeTransactionAsync(browserId, token);
            if (transaction is null) return fail("expired");
            if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - transaction.CreatedAt > 600_000 ||
                transaction.CreatedAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 5_000 ||
                transaction.RedirectUri != config.RedirectUri) return fail("expired");
            next = SharedReturnPath(transaction.Next);

            var states = context.Request.Query["state"];
            var codes = context.Request.Query["code"];
            var errors = context.Request.Query["error"];
            if (states.Count != 1 || codes.Count > 1 || errors.Count > 1 || (codes.Count == 1 && errors.Count == 1)) return fail("failed");
            var state = states[0] ?? string.Empty;
            if (!IsRandomToken(state, 43) || !FixedEquals(state, transaction.State)) return fail("failed");
            if (errors.Count == 1) return fail(errors[0] == "access_denied" ? "cancelled" : "failed");
            var code = codes.Count == 1 ? codes[0] : null;
            if (string.IsNullOrWhiteSpace(code) || code.Length > 8192) return fail("failed");

            if (transaction.Mode == "link")
            {
                var current = await ReadCookieSessionOrCurrentBearerAsync(context, config.Supabase, token);
                if (current.Unavailable) return fail("temporarily-unavailable");
                var userLookup = current.Session?.AccessToken is { Length: > 0 } accessToken
                    ? await GetSessionUserAsync(config.Supabase, accessToken, token)
                    : new SessionUserLookup(null, false);
                if (userLookup.Unavailable) return fail("temporarily-unavailable");
                if (!Guid.TryParse(userLookup.User?.Id, out var currentId) || currentId.ToString("D").ToLowerInvariant() != transaction.LinkedUserId)
                    return fail("sign-in-required");
            }

            var exchange = await ExchangeAndVerifyAsync(config.Provider, transaction, code, token);
            if (exchange.Identity is null) return fail(exchange.Unavailable ? "temporarily-unavailable" : "failed");
            var result = await ProvisionIdentityAsync(config, exchange.Identity, transaction.LinkedUserId, context, token);
            if (result == IdentityProvisionResult.Conflict) return fail("identity-conflict");
            if (result != IdentityProvisionResult.Success) return fail("temporarily-unavailable");
            return transaction.Mode == "link"
                ? OpenAiRedirect(context, "linked", next, config.Origin)
                : Results.Redirect(new Uri(new Uri(config.Origin), next).ToString());
        }).AllowAnonymous().WithName("OpenAiSignInCallback").WithTags("Authentication");
    }

    private static async Task<DiscoveryResult> DiscoverAsync(OpenAiProviderConfiguration config, CancellationToken token)
    {
        var response = await ReadJsonAsync(OpenAiHttp, OpenAiDiscovery, HttpMethod.Get, null, null, 64_000, token);
        if (response.Json is not { } json || GetString(json, "issuer") != OpenAiIssuer)
            return new(null, true);
        var authorization = ApprovedOpenAiEndpoint(GetString(json, "authorization_endpoint"));
        var tokenEndpoint = ApprovedOpenAiEndpoint(GetString(json, "token_endpoint"));
        var jwks = ApprovedOpenAiEndpoint(GetString(json, "jwks_uri"));
        if (authorization is null || tokenEndpoint is null || jwks is null) return new(null, true);
        if (json.TryGetProperty("token_endpoint_auth_methods_supported", out var methods) &&
            (methods.ValueKind != JsonValueKind.Array || !methods.EnumerateArray().Any(value =>
                value.ValueKind == JsonValueKind.String && value.GetString() == config.TokenAuthentication)))
            return new(null, true);
        return new(new(authorization, tokenEndpoint, jwks), false);
    }

    private static async Task<IdentityExchangeResult> ExchangeAndVerifyAsync(
        OpenAiProviderConfiguration config,
        OpenAiTransaction transaction,
        string code,
        CancellationToken token)
    {
        var discovered = await DiscoverAsync(config, token);
        var discovery = discovered.Discovery;
        if (discovery is null) return new(null, discovered.Unavailable);
        if (transaction.RedirectUri != config.RedirectUri || !IsVerifier(transaction.CodeVerifier)) return new(null, false);
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = transaction.RedirectUri,
            ["client_id"] = config.ClientId,
            ["code_verifier"] = transaction.CodeVerifier
        };
        var headers = new Dictionary<string, string>();
        if (config.TokenAuthentication == "client_secret_basic")
        {
            var client = FormEscape(config.ClientId);
            var secret = FormEscape(config.ClientSecret!);
            headers["Authorization"] = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes(client + ":" + secret));
        }
        var tokenResponse = await ReadJsonAsync(OpenAiHttp, discovery.TokenEndpoint, HttpMethod.Post, form, headers, 64_000, token);
        if (tokenResponse.Json is not { } tokenJson) return new(null, tokenResponse.Unavailable);
        var idToken = GetString(tokenJson, "id_token");
        if (string.IsNullOrWhiteSpace(idToken) || idToken.Length > 32_000) return new(null, false);
        var jwksResponse = await ReadJsonAsync(OpenAiHttp, discovery.JwksUri, HttpMethod.Get, null, null, 256_000, token);
        if (jwksResponse.Json is not { } jwksJson) return new(null, jwksResponse.Unavailable);
        var keySet = TryReadKeySet(jwksJson);
        if (keySet is null) return new(null, false);
        var jwtHandler = new JwtSecurityTokenHandler { MapInboundClaims = false, MaximumTokenSizeInBytes = 32_000 };
        ClaimsPrincipal principal;
        try
        {
            principal = ValidateIdentityToken(jwtHandler, idToken, config.ClientId, keySet, jwksJson);
        }
        catch (SecurityTokenSignatureKeyNotFoundException)
        {
            // Match Next's bounded JWKS rollover recovery. A bad signature with a known key does not trigger a refetch.
            var refreshedResponse = await ReadJsonAsync(OpenAiHttp, discovery.JwksUri, HttpMethod.Get, null, null, 256_000, token);
            if (refreshedResponse.Json is not { } refreshedJwks) return new(null, refreshedResponse.Unavailable);
            var refreshedKeys = TryReadKeySet(refreshedJwks);
            if (refreshedKeys is null) return new(null, false);
            try { principal = ValidateIdentityToken(jwtHandler, idToken, config.ClientId, refreshedKeys, refreshedJwks); }
            catch (SecurityTokenException) { return new(null, false); }
            catch (ArgumentException) { return new(null, false); }
        }
        catch (SecurityTokenException) { return new(null, false); }
        catch (ArgumentException) { return new(null, false); }

        var jwt = jwtHandler.ReadJwtToken(idToken);
        var payload = jwt.Payload;
        var subject = principal.FindFirst("sub")?.Value;
        var nonce = principal.FindFirst("nonce")?.Value;
        var issuedAt = ReadIntegerClaim(payload, "iat");
        var expiresAt = ReadIntegerClaim(payload, "exp");
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 512 ||
            !FixedEquals(nonce ?? string.Empty, transaction.Nonce) ||
            issuedAt is null || issuedAt > now + 5 || expiresAt is null || expiresAt <= issuedAt ||
            !OptionalClaim(principal.FindFirst("email")?.Value, 320) ||
            !OptionalClaim(principal.FindFirst("name")?.Value, 500) ||
            !OptionalClaim(principal.FindFirst("picture")?.Value, 2048)) return new(null, false);
        var verifiedClaim = payload.TryGetValue("email_verified", out var rawVerified) ? rawVerified : null;
        if (verifiedClaim is not null && verifiedClaim is not bool) return new(null, false);
        return new(new(OpenAiIssuer, config.ClientId, subject,
            principal.FindFirst("email")?.Value,
            verifiedClaim is true, principal.FindFirst("name")?.Value,
            principal.FindFirst("picture")?.Value), false);
    }

    private static ClaimsPrincipal ValidateIdentityToken(
        JwtSecurityTokenHandler handler,
        string idToken,
        string clientId,
        JsonWebKeySet keySet,
        JsonElement jwksJson)
    {
        var parsed = handler.ReadJwtToken(idToken);
        if (parsed.Header.Alg == "EdDSA")
            return ValidateEdDsaIdentityToken(parsed, jwksJson, clientId);
        return handler.ValidateToken(idToken, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = OpenAiIssuer,
            ValidateAudience = true,
            ValidAudience = clientId,
            ValidateIssuerSigningKey = true,
            IssuerSigningKeys = keySet.GetSigningKeys(),
            ValidAlgorithms = OpenAiAlgorithms,
            RequireSignedTokens = true,
            RequireExpirationTime = true,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(5)
        }, out _);
    }

    private static ClaimsPrincipal ValidateEdDsaIdentityToken(
        JwtSecurityToken jwt,
        JsonElement jwksJson,
        string clientId)
    {
        if (jwt.Header.Alg != "EdDSA" || jwksJson.ValueKind != JsonValueKind.Object ||
            !jwksJson.TryGetProperty("keys", out var keys) || keys.ValueKind != JsonValueKind.Array)
            throw new SecurityTokenInvalidSignatureException();
        if (jwt.Header.ContainsKey("crit") ||
            jwt.Header.TryGetValue("b64", out var encodedPayload) && encodedPayload is not true)
            throw new SecurityTokenInvalidSignatureException("Unsupported critical EdDSA JWS header.");

        var kid = jwt.Header.Kid;
        var matchingKeys = keys.EnumerateArray().Where(key =>
            key.ValueKind == JsonValueKind.Object &&
            GetString(key, "kty") == "OKP" && GetString(key, "crv") == "Ed25519" &&
            (kid is null || GetString(key, "kid") == kid) &&
            (GetString(key, "use") is null or "sig") &&
            (GetString(key, "alg") is null or "EdDSA") &&
            (!key.TryGetProperty("key_ops", out var operations) ||
             operations.ValueKind == JsonValueKind.Array && operations.EnumerateArray().Any(operation =>
                 operation.ValueKind == JsonValueKind.String && operation.GetString() == "verify")))
            .ToArray();
        if (matchingKeys.Length == 0) throw new SecurityTokenSignatureKeyNotFoundException("No matching Ed25519 signing key was found.");
        if (matchingKeys.Length != 1) throw new SecurityTokenInvalidSignatureException("Multiple Ed25519 signing keys matched the token.");

        try
        {
            var x = GetString(matchingKeys[0], "x");
            var tokenParts = jwt.RawData.Split('.');
            if (x is null || !Regex.IsMatch(x, "^[A-Za-z0-9_-]{43}$") || tokenParts.Length != 3 ||
                tokenParts.Any(part => !Regex.IsMatch(part, "^[A-Za-z0-9_-]+$")) ||
                tokenParts[2].Length != 86) throw new FormatException();
            var publicKey = DecodeBase64Url(x);
            var signature = DecodeBase64Url(tokenParts[2]);
            if (publicKey.Length != 32 || signature.Length != 64) throw new FormatException();
            var key = PublicKey.Import(SignatureAlgorithm.Ed25519, publicKey, KeyBlobFormat.RawPublicKey);
            var signingInput = Encoding.ASCII.GetBytes(tokenParts[0] + "." + tokenParts[1]);
            if (!SignatureAlgorithm.Ed25519.Verify(key, signingInput, signature))
                throw new SecurityTokenInvalidSignatureException();
        }
        catch (FormatException exception)
        {
            throw new SecurityTokenInvalidSignatureException("The Ed25519 JWK or signature encoding is invalid.", exception);
        }
        catch (ArgumentException exception)
        {
            throw new SecurityTokenInvalidSignatureException("The Ed25519 public key is invalid.", exception);
        }

        var payload = jwt.Payload;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var expires = ReadIntegerClaim(payload, "exp");
        var notBefore = ReadIntegerClaim(payload, "nbf");
        var audience = payload.TryGetValue("aud", out var rawAudience) ? rawAudience : null;
        var audienceValid = audience is string one && one == clientId ||
            audience is IEnumerable<object> many && many.Any(item => item is string value && value == clientId);
        if (!payload.TryGetValue("iss", out var issuer) || issuer is not string issuerValue || issuerValue != OpenAiIssuer ||
            !audienceValid || expires is null || expires <= now - 5 ||
            notBefore is not null && notBefore > now + 5)
            throw new SecurityTokenValidationException("The Ed25519 identity token claims are invalid.");
        return new ClaimsPrincipal(new ClaimsIdentity(jwt.Claims, "OpenID"));
    }

    private static JsonWebKeySet? TryReadKeySet(JsonElement? jwksJson)
    {
        if (jwksJson is null || !jwksJson.Value.TryGetProperty("keys", out var keys) ||
            keys.ValueKind != JsonValueKind.Array || keys.GetArrayLength() is < 1 or > 100) return null;
        try
        {
            return new JsonWebKeySet(jwksJson.Value.GetRawText());
        }
        catch (ArgumentException) { return null; }
        catch (SecurityTokenException) { return null; }
    }

    private static async Task<IdentityProvisionResult> ProvisionIdentityAsync(
        OpenAiConfiguration config,
        VerifiedOpenAiIdentity identity,
        string? linkedUserId,
        HttpContext context,
        CancellationToken token)
    {
        var store = new OpenAiStore(config.Store);
        var identityKey = store.IdentityKey(identity);
        if (identityKey is null) return IdentityProvisionResult.Unavailable;
        var mappedUser = await store.ReadIdentityAsync(identityKey, token);
        if (mappedUser.Invalid) return IdentityProvisionResult.Unavailable;
        var mapped = mappedUser.Value;
        if (linkedUserId is not null && mapped is not null && mapped != linkedUserId) return IdentityProvisionResult.Conflict;
        var userId = linkedUserId ?? mapped;
        var isNewIdentity = userId is null;
        if (userId is null)
        {
            var alias = $"chatgpt+{identityKey[..48]}@identity.recall.invalid";
            object metadata = identity.Name is null ? new { } : new { name = identity.Name };
            var created = await SupabaseAdminAsync(config, HttpMethod.Post, "/auth/v1/admin/users", new
            {
                email = alias,
                email_confirm = true,
                app_metadata = new { openai_identity_key = identityKey },
                user_metadata = metadata
            }, token);
            userId = created is null ? null : GetString(created.Value, "id");
            if (userId is null)
            {
                var recover = await SupabaseAdminAsync(config, HttpMethod.Post, "/auth/v1/admin/generate_link", new { type = "magiclink", email = alias }, token);
                var recoveredUser = recover is null ? null : GetObject(recover.Value, "user");
                var recoveredMetadata = recoveredUser is null ? null : GetObject(recoveredUser.Value, "app_metadata");
                var recoveredId = recoveredUser is null ? null : GetString(recoveredUser.Value, "id");
                if (recoveredMetadata is null || recoveredId is null ||
                    GetString(recoveredMetadata.Value, "openai_identity_key") != identityKey ||
                    GetString(recoveredUser!.Value, "email") != alias) return IdentityProvisionResult.Unavailable;
                userId = recoveredId;
            }
        }

        if (!Guid.TryParse(userId, out var canonicalId)) return IdentityProvisionResult.Unavailable;
        userId = canonicalId.ToString("D").ToLowerInvariant();
        var account = await SupabaseAdminAsync(config, HttpMethod.Get, $"/auth/v1/admin/users/{userId}", null, token);
        var accountUserId = account is null ? null : GetString(account.Value, "id");
        var email = account is null ? null : GetString(account.Value, "email");
        if (accountUserId != userId || string.IsNullOrWhiteSpace(email) ||
            (isNewIdentity && (email != $"chatgpt+{identityKey[..48]}@identity.recall.invalid" ||
                GetString(GetObject(account!.Value, "app_metadata") ?? default, "openai_identity_key") != identityKey)))
            return IdentityProvisionResult.Unavailable;

        var binding = await store.BindIdentityAsync(identityKey, userId, token);
        if (binding == StoreBindingResult.Conflict) return IdentityProvisionResult.Conflict;
        if (binding != StoreBindingResult.Success) return IdentityProvisionResult.Unavailable;
        if (linkedUserId is not null) return IdentityProvisionResult.Success;

        var link = await SupabaseAdminAsync(config, HttpMethod.Post, "/auth/v1/admin/generate_link", new { type = "magiclink", email }, token);
        var linkUser = link is null ? null : GetObject(link.Value, "user");
        var properties = link is null ? null : GetObject(link.Value, "properties");
        var linkUserId = linkUser is null ? null : GetString(linkUser.Value, "id");
        var hashedToken = properties is null ? null : GetString(properties.Value, "hashed_token");
        if (linkUserId != userId || string.IsNullOrWhiteSpace(hashedToken)) return IdentityProvisionResult.Unavailable;
        var session = await SupabaseAuthAsync(config, "/auth/v1/verify", new { token_hash = hashedToken, type = "magiclink" }, token);
        var sessionUser = session is null ? null : GetObject(session.Value, "user");
        var sessionUserId = sessionUser is null ? null : GetString(sessionUser.Value, "id");
        if (session is null || sessionUserId != userId) return IdentityProvisionResult.Unavailable;
        var sessionEnvelope = JsonSerializer.Deserialize<SessionEnvelope>(session.Value.GetRawText(), JsonOptions);
        if (sessionEnvelope?.AccessToken is null || sessionEnvelope.RefreshToken is null) return IdentityProvisionResult.Unavailable;
        WriteSessionCookies(context, config.Supabase, sessionEnvelope);
        return IdentityProvisionResult.Success;
    }

    private static async Task<JsonElement?> SupabaseAdminAsync(OpenAiConfiguration config, HttpMethod method, string path, object? body, CancellationToken token) =>
        await SupabaseRequestAsync(config, method, path, body, token, admin: true);

    private static async Task<JsonElement?> SupabaseAuthAsync(OpenAiConfiguration config, string path, object body, CancellationToken token) =>
        await SupabaseRequestAsync(config, HttpMethod.Post, path, body, token, admin: false);

    private static async Task<JsonElement?> SupabaseRequestAsync(OpenAiConfiguration config, HttpMethod method, string path, object? body, CancellationToken token, bool admin)
    {
        try
        {
            using var request = new HttpRequestMessage(method, new Uri(config.Supabase.Url, path));
            var key = admin ? config.ServiceRoleKey : config.Supabase.PublishableKey;
            request.Headers.TryAddWithoutValidation("apikey", key);
            if (admin) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ServiceRoleKey);
            if (body is not null) request.Content = JsonContent.Create(body);
            using var response = await OpenAiHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode ? await ReadResponseJsonAsync(response, 65_536, token) : null;
        }
        catch (HttpRequestException) { return null; }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private static async Task<string> AuthorizationUrl(string endpoint, string clientId, OpenAiTransaction tx)
    {
        var url = new UriBuilder(endpoint);
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["redirect_uri"] = tx.RedirectUri,
            ["response_type"] = "code",
            ["scope"] = "openid profile email",
            ["state"] = tx.State,
            ["code_challenge"] = tx.CodeChallenge,
            ["code_challenge_method"] = "S256",
            ["nonce"] = tx.Nonce
        });
        url.Query = await content.ReadAsStringAsync();
        return url.Uri.ToString();
    }

    private static async Task<ProviderJsonResult> ReadJsonAsync(HttpClient client, string url, HttpMethod method,
        IReadOnlyDictionary<string, string>? form, IReadOnlyDictionary<string, string>? headers, int limit, CancellationToken token)
    {
        try
        {
            using var request = new HttpRequestMessage(method, url);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (headers is not null)
                foreach (var header in headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
            if (form is not null) request.Content = new FormUrlEncodedContent(form);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode)
                return new(null, (int)response.StatusCode == 429 || (int)response.StatusCode >= 500);
            return new(await ReadResponseJsonAsync(response, limit, token), false);
        }
        catch (HttpRequestException) { return new(null, true); }
        catch (OperationCanceledException) when (!token.IsCancellationRequested) { return new(null, true); }
        catch (JsonException) { return new(null, false); }
        catch (IOException) { return new(null, true); }
    }

    private static async Task<JsonElement?> ReadResponseJsonAsync(HttpResponseMessage response, int limit, CancellationToken token)
    {
        if (response.Content.Headers.ContentLength is > 0 and var length && length > limit) return null;
        await using var stream = await response.Content.ReadAsStreamAsync(token);
        using var memory = new MemoryStream(Math.Min(limit, 16_384));
        var buffer = new byte[8192];
        while (true)
        {
            var read = await stream.ReadAsync(buffer, token);
            if (read == 0) break;
            if (memory.Length + read > limit) return null;
            memory.Write(buffer, 0, read);
        }
        using var document = JsonDocument.Parse(memory.ToArray());
        return document.RootElement.Clone();
    }

    private static string? ApprovedOpenAiEndpoint(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !uri.IsDefaultPort || !string.Equals(uri.Host, "auth.openai.com", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) return null;
        return uri.ToString();
    }

    private static string? GetString(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString() : null;

    private static JsonElement? GetObject(JsonElement value, string name) =>
        value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Object
            ? property : null;

    private static long? ReadIntegerClaim(JwtPayload payload, string name)
    {
        if (!payload.TryGetValue(name, out var raw) || raw is null) return null;
        return long.TryParse(Convert.ToString(raw, CultureInfo.InvariantCulture), NumberStyles.Integer,
            CultureInfo.InvariantCulture, out var value) ? value : null;
    }

    private static bool OptionalClaim(string? value, int limit) => value is null || value.Length <= limit;
    private static bool IsVerifier(string value) => value.Length is >= 43 and <= 128 && value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '.' or '_' or '~');
    private static bool IsRandomToken(string value, int length) => value.Length == length && value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_');
    private static bool FixedEquals(string left, string right) =>
        left.Length == right.Length && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(left), Encoding.UTF8.GetBytes(right));
    private static string RandomBase64Url(int bytes) => Base64Url(RandomNumberGenerator.GetBytes(bytes));
    private static string Base64Url(byte[] value) => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string FormEscape(string value) => Uri.EscapeDataString(value).Replace("%20", "+");

    private static bool RequestMatchesOrigin(HttpRequest request, string expectedOrigin) =>
        Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out var requestUri) &&
        Uri.TryCreate(expectedOrigin, UriKind.Absolute, out var expectedUri) &&
        string.IsNullOrEmpty(expectedUri.UserInfo) && expectedUri.AbsolutePath == "/" &&
        string.IsNullOrEmpty(expectedUri.Query) && string.IsNullOrEmpty(expectedUri.Fragment) &&
        string.Equals(requestUri.GetLeftPart(UriPartial.Authority), expectedUri.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase);

    private static string SharedReturnPath(string? input)
    {
        if (input is null) return "/";
        var match = System.Text.RegularExpressions.Regex.Match(input, "^/shared/([^/?#]+)(?:\\?token=([^&#]+))?$");
        if (!match.Success || !Guid.TryParse(match.Groups[1].Value, out var id)) return "/";
        var version = id.ToString("D").ToLowerInvariant();
        if (!match.Groups[2].Success) return $"/shared/{version}";
        var shareToken = match.Groups[2].Value;
        return IsRandomToken(shareToken, 43) ? $"/shared/{version}?token={Uri.EscapeDataString(shareToken)}" : "/";
    }

    private static IResult OpenAiRedirect(HttpContext context, string reason, string next, string? origin)
    {
        _ = origin;
        var target = "/sign-in?openai=" + Uri.EscapeDataString(reason) +
            (next == "/" ? string.Empty : "&next=" + Uri.EscapeDataString(next));
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        return Results.Redirect(target);
    }

    private static void ClearOpenAiTransactionCookie(HttpContext context, bool secure)
    {
        foreach (var name in new[] { "__Host-recall-openai", "recall-openai-local" })
            context.Response.Cookies.Delete(name, new CookieOptions { Path = "/", Secure = name.StartsWith("__Host-", StringComparison.Ordinal) || secure, HttpOnly = true, SameSite = SameSiteMode.Lax });
    }

    private sealed record OpenAiProviderConfiguration(string ClientId, string RedirectUri, string TokenAuthentication, string? ClientSecret);
    private sealed record OpenAiStoreConfiguration(string Url, string Token, string IdentityKeySecret, string Prefix);
    private sealed record OpenAiConfiguration(OpenAiProviderConfiguration Provider, OpenAiStoreConfiguration Store,
        SupabaseConfiguration Supabase, string ServiceRoleKey, string Origin,
        string CookieName, bool SecureCookie, string RedirectUri)
    {
        public static OpenAiConfiguration? TryCreate(string? projectUrl, string? publishableKey, bool secureCookies)
        {
            var clientId = Environment.GetEnvironmentVariable("OPENAI_SIWC_CLIENT_ID")?.Trim();
            var redirect = Environment.GetEnvironmentVariable("OPENAI_SIWC_REDIRECT_URI")?.Trim();
            var method = Environment.GetEnvironmentVariable("OPENAI_SIWC_CLIENT_AUTH_METHOD")?.Trim();
            var secret = Environment.GetEnvironmentVariable("OPENAI_SIWC_CLIENT_SECRET");
            var redisUrl = Environment.GetEnvironmentVariable("SIWC_STORE_REST_URL")?.Trim();
            var redisToken = Environment.GetEnvironmentVariable("SIWC_STORE_REST_TOKEN")?.Trim();
            var identitySecret = Environment.GetEnvironmentVariable("SIWC_IDENTITY_KEY_SECRET");
            var serviceRole = Environment.GetEnvironmentVariable("SUPABASE_SERVICE_ROLE_KEY")?.Trim();
            var prefix = Environment.GetEnvironmentVariable("SIWC_STORE_PREFIX")?.Trim();
            if (string.IsNullOrWhiteSpace(prefix)) prefix = "recall:siwc";
            if (string.IsNullOrWhiteSpace(clientId) || clientId.Length > 200 || string.IsNullOrWhiteSpace(redirect) ||
                string.IsNullOrWhiteSpace(redisUrl) || string.IsNullOrWhiteSpace(redisToken) ||
                string.IsNullOrWhiteSpace(identitySecret) || identitySecret.Length < 32 ||
                string.IsNullOrWhiteSpace(serviceRole) || method is not ("none" or "client_secret_basic") ||
                (method == "none" && !string.IsNullOrEmpty(secret)) ||
                (method == "client_secret_basic" && (string.IsNullOrEmpty(secret) || secret.Length > 5000)) ||
                !Regex.IsMatch(prefix!, "^[A-Za-z0-9:_-]{1,64}$")) return null;
            if (!Uri.TryCreate(redirect, UriKind.Absolute, out var callback) || callback.AbsolutePath != "/auth/openai/callback" ||
                callback.Query.Length != 0 || callback.Fragment.Length != 0 || !string.IsNullOrEmpty(callback.UserInfo) ||
                (callback.Scheme != "https" && !(callback.Scheme == "http" && IsAllowedDevelopmentLoopback(callback) && !secureCookies))) return null;
            if (!Uri.TryCreate(redisUrl, UriKind.Absolute, out var storeUrl) || storeUrl.Scheme != "https" ||
                !string.IsNullOrEmpty(storeUrl.UserInfo) || storeUrl.Query.Length > 0 || storeUrl.Fragment.Length > 0) return null;
            var supabase = SupabaseConfiguration.TryCreate(projectUrl, publishableKey, secureCookies);
            if (supabase is null) return null;
            var secure = callback.Scheme == "https";
            return new(new(clientId!, callback.ToString(), method!, secret),
                new(storeUrl.ToString(), redisToken!, identitySecret!, prefix!), supabase, serviceRole!,
                callback.GetLeftPart(UriPartial.Authority),
                secure ? "__Host-recall-openai" : "recall-openai-local", secure, callback.ToString());
        }
    }

    private static bool IsAllowedDevelopmentLoopback(Uri callback)
    {
        var hostname = callback.DnsSafeHost.ToLowerInvariant();
        return hostname is "localhost" or "127.0.0.1" or "::1";
    }

    private sealed record OpenAiTransaction(string State, string Nonce, string CodeVerifier, string CodeChallenge,
        string RedirectUri, string Mode, string? LinkedUserId, string Next, long CreatedAt);
    private sealed record OidcDiscovery(string AuthorizationEndpoint, string TokenEndpoint, string JwksUri);
    private sealed record DiscoveryResult(OidcDiscovery? Discovery, bool Unavailable);
    private sealed record IdentityExchangeResult(VerifiedOpenAiIdentity? Identity, bool Unavailable);
    private sealed record ProviderJsonResult(JsonElement? Json, bool Unavailable);
    private sealed record VerifiedOpenAiIdentity(string Issuer, string ClientId, string Subject, string? Email,
        bool EmailVerified, string? Name, string? Picture);
    private enum IdentityProvisionResult { Success, Conflict, Unavailable }
    private enum StoreBindingResult { Success, Conflict, Unavailable }
    private sealed record StoreReadResult(string? Value, bool Invalid)
    {
        public static implicit operator StoreReadResult(string? value) => new(value, false);
        public static StoreReadResult InvalidResult => new(null, true);
    }

    private sealed class OpenAiStore(OpenAiStoreConfiguration configuration)
    {
        private static readonly string BindScript = "local existing=redis.call('GET',KEYS[1]); if existing and existing~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[1]); redis.call('SADD',KEYS[2],KEYS[1]); return 1";
        private string Key(string suffix) => $"{configuration.Prefix}:{suffix}";

        public string? IdentityKey(VerifiedOpenAiIdentity identity)
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(configuration.IdentityKeySecret));
            var bytes = JsonSerializer.SerializeToUtf8Bytes(new[] { identity.Issuer, identity.ClientId, identity.Subject },
                new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            return Convert.ToHexStringLower(hmac.ComputeHash(bytes));
        }

        public async Task<bool> CreateTransactionAsync(string browserId, OpenAiTransaction transaction, CancellationToken token)
        {
            var result = await CommandAsync(new object?[] { "SET", Key("transaction:" + browserId), JsonSerializer.Serialize(transaction, JsonOptions), "NX", "PX", 600000 }, token);
            return result.ValueKind == JsonValueKind.String && result.GetString() == "OK";
        }

        public async Task<OpenAiTransaction?> ConsumeTransactionAsync(string browserId, CancellationToken token)
        {
            var result = await CommandAsync(new object?[] { "GETDEL", Key("transaction:" + browserId) }, token);
            if (result.ValueKind != JsonValueKind.String) return null;
            try
            {
                var transaction = JsonSerializer.Deserialize<OpenAiTransaction>(result.GetString()!, JsonOptions);
                return transaction is not null && transaction.State is not null && IsRandomToken(transaction.State, 43) &&
                    transaction.Nonce is not null && IsRandomToken(transaction.Nonce, 43) &&
                    transaction.CodeVerifier is not null && IsVerifier(transaction.CodeVerifier) &&
                    transaction.CodeChallenge is not null && IsRandomToken(transaction.CodeChallenge, 43) &&
                    !string.IsNullOrWhiteSpace(transaction.RedirectUri) && transaction.RedirectUri.Length <= 2048 &&
                    (transaction.Mode == "sign-in" || transaction.Mode == "link") &&
                    (transaction.LinkedUserId is null || Guid.TryParse(transaction.LinkedUserId, out _)) &&
                    !string.IsNullOrWhiteSpace(transaction.Next) && transaction.Next.Length <= 512 &&
                    transaction.CreatedAt >= 0 ? transaction : null;
            }
            catch (JsonException) { return null; }
        }

        public async Task<StoreReadResult> ReadIdentityAsync(string key, CancellationToken token)
        {
            var result = await CommandAsync(new object?[] { "GET", Key("identity:" + key) }, token);
            if (result.ValueKind == JsonValueKind.Null) return new StoreReadResult(null, false);
            if (result.ValueKind != JsonValueKind.String || !Guid.TryParse(result.GetString(), out var id)) return StoreReadResult.InvalidResult;
            return new StoreReadResult(id.ToString("D").ToLowerInvariant(), false);
        }

        public async Task<StoreBindingResult> BindIdentityAsync(string identityKey, string userId, CancellationToken token)
        {
            var result = await CommandAsync(new object?[] { "EVAL", BindScript, 2, Key("identity:" + identityKey), Key("user:" + userId), userId }, token);
            if (result.ValueKind == JsonValueKind.Number && result.TryGetInt32(out var code))
                return code == 1 ? StoreBindingResult.Success : code == 0 ? StoreBindingResult.Conflict : StoreBindingResult.Unavailable;
            return StoreBindingResult.Unavailable;
        }

        private async Task<JsonElement> CommandAsync(object?[] command, CancellationToken token)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, configuration.Url);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", configuration.Token);
                request.Content = JsonContent.Create(command);
                using var response = await OpenAiHttp.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
                if (!response.IsSuccessStatusCode) return JsonDocument.Parse("null").RootElement.Clone();
                var document = await ReadResponseJsonAsync(response, 32_768, token);
                if (document is null || !document.Value.TryGetProperty("result", out var result) || document.Value.TryGetProperty("error", out _))
                    return JsonDocument.Parse("null").RootElement.Clone();
                return result.Clone();
            }
            catch (HttpRequestException) { return JsonDocument.Parse("null").RootElement.Clone(); }
            catch (OperationCanceledException) when (!token.IsCancellationRequested) { return JsonDocument.Parse("null").RootElement.Clone(); }
            catch (JsonException) { return JsonDocument.Parse("null").RootElement.Clone(); }
            catch (IOException) { return JsonDocument.Parse("null").RootElement.Clone(); }
        }
    }
}
