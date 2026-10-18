using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.IdentityModel.Tokens.Jwt;

namespace Recall.Api.Features.Auth;

public static partial class AuthEndpoints
{
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

}
