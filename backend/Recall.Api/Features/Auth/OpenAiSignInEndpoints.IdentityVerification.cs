using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.IdentityModel.Tokens;
using NSec.Cryptography;

namespace Recall.Api.Features.Auth;

public static partial class AuthEndpoints
{
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

}
