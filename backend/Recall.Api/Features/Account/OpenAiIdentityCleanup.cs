using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Account;

internal static class OpenAiIdentityCleanup
{
    private const string CleanupScript = "local identities=redis.call('SMEMBERS',KEYS[1]); for _,key in ipairs(identities) do if redis.call('GET',key)==ARGV[1] then redis.call('DEL',key) end end; redis.call('DEL',KEYS[1]); return 1";

    internal static async Task<bool> CleanupIfConfiguredAsync(
        IConfiguration configuration,
        HttpClient client,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var rawUrl = configuration["SIWC_STORE_REST_URL"]?.Trim();
        var token = configuration["SIWC_STORE_REST_TOKEN"]?.Trim();
        var identitySecret = configuration["SIWC_IDENTITY_KEY_SECRET"];
        var prefix = configuration["SIWC_STORE_PREFIX"]?.Trim();
        if (string.IsNullOrWhiteSpace(prefix)) prefix = null;
        // Match the web account-delete configuration gate: a prefix alone does not enable SIWC storage.
        var requested = rawUrl is not null || token is not null || identitySecret is not null;
        if (!requested) return true;

        if (string.IsNullOrWhiteSpace(rawUrl) || string.IsNullOrWhiteSpace(token) ||
            identitySecret is null || identitySecret.Length < 32 ||
            (prefix is not null && !System.Text.RegularExpressions.Regex.IsMatch(prefix, "^[A-Za-z0-9:_-]{1,64}$")) ||
            !Uri.TryCreate(rawUrl, UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(url.UserInfo) || !string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment))
            return false;

        var userKey = $"{prefix ?? "recall:siwc"}:user:{userId:D}";
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, url);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                request.Content = JsonContent.Create(new object?[] { "EVAL", CleanupScript, 1, userKey, userId.ToString("D") });
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                    if (document.RootElement.ValueKind == JsonValueKind.Object &&
                        !document.RootElement.TryGetProperty("error", out _) &&
                        document.RootElement.TryGetProperty("result", out var result) &&
                        result.ValueKind == JsonValueKind.Number && result.TryGetInt32(out var code) && code == 1)
                        return true;
                }
            }
            catch (HttpRequestException) { }
            catch (JsonException) { }
            catch (IOException) { }

            if (attempt < 2)
            {
                try { await Task.Delay(TimeSpan.FromMilliseconds(250 * (1 << attempt)), cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return false; }
            }
        }
        return false;
    }
}
