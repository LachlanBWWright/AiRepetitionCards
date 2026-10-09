using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.RateLimits;

/// <summary>Atomic Upstash-compatible REST Redis fixed windows. Any error fails closed.</summary>
public sealed class RedisRestApiRateLimitStore : IApiRateLimitStore, IDisposable
{
    private const string Script = """
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        local width = tonumber(ARGV[1])
        local limit = tonumber(ARGV[2])
        local window = math.floor(now / width)
        local ttl = (window + 1) * width - now
        local retry = math.max(1, math.ceil(ttl / 1000))
        local previous = redis.call('HMGET', KEYS[1], 'window', 'count')
        local count = 0
        if previous[1] or previous[2] then
          local previousWindow = tonumber(previous[1])
          local previousCount = tonumber(previous[2])
          if not previousWindow or previousWindow < 0 or previousWindow > window or
            previousWindow ~= math.floor(previousWindow) or not previousCount or
            previousCount < 0 or previousCount > 120 or previousCount ~= math.floor(previousCount) then
            return {-1, 0, retry}
          end
          if previousWindow == window then count = previousCount end
        end
        if count >= limit then return {0, 0, retry} end
        count = count + 1
        redis.call('HSET', KEYS[1], 'window', window, 'count', count)
        redis.call('PEXPIRE', KEYS[1], ttl + 1000)
        return {1, limit - count, retry}
        """;

    private readonly Uri? _endpoint;
    private readonly string? _token;
    private readonly string? _prefix;
    private readonly HttpClient _http;
    private readonly string? _configurationFailure;

    public RedisRestApiRateLimitStore(ApiRateLimitConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        _token = configuration.RestToken;
        _prefix = configuration.Prefix;
        if (!Uri.TryCreate(configuration.RestUrl, UriKind.Absolute, out var endpoint) ||
            (endpoint.Scheme != Uri.UriSchemeHttps && !(configuration.IsDevelopment && endpoint.Scheme == Uri.UriSchemeHttp && IsLoopback(endpoint))) ||
            !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment))
            _configurationFailure = "configuration";
        else if (string.IsNullOrWhiteSpace(_token) || _token.Length > 4096 || _token.Any(character => character is < (char)0x21 or > (char)0x7e) ||
            string.IsNullOrWhiteSpace(_prefix) || _prefix.Length > 64 || _prefix.Any(character => !char.IsAsciiLetterOrDigit(character) && character is not ':' and not '_' and not '-'))
            _configurationFailure = "configuration";
        else
            _endpoint = endpoint;

        var handler = new HttpClientHandler { AllowAutoRedirect = false };
        _http = new HttpClient(handler, disposeHandler: true) { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async ValueTask<ApiRateLimitStoreResult> ConsumeAsync(
        string subject,
        ApiRateLimitScope scope,
        ApiRateLimitPolicy policy,
        CancellationToken cancellationToken)
    {
        if (_configurationFailure is not null || _endpoint is null || _token is null || _prefix is null)
            return ApiRateLimitStoreResult.Unavailable("configuration");
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 128 || ApiRateLimitScopeCompatibility.ContractName(scope).Length == 0 || policy.Requests is < 1 or > 120 ||
            policy.Window < TimeSpan.FromSeconds(1) || policy.Window > TimeSpan.FromMinutes(1) || policy.Window.TotalMilliseconds % 1 != 0)
            return ApiRateLimitStoreResult.Unavailable("invalid-request");

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            var scoped = JsonSerializer.Serialize(new object[] { subject, ApiRateLimitScopeCompatibility.ContractName(scope) });
            var digest = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(scoped)));
            var payload = JsonSerializer.Serialize(new object[]
            {
                "EVAL", Script, 1, $"{_prefix}:v1:{digest}", checked((long)policy.Window.TotalMilliseconds), policy.Requests
            });
            using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint);
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
            request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
            if (response.StatusCode is < HttpStatusCode.OK or >= HttpStatusCode.MultipleChoices ||
                response.Content.Headers.ContentLength is > 4096)
                return ApiRateLimitStoreResult.Unavailable("store-unavailable");

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            using var bounded = new MemoryStream();
            var buffer = new byte[1024];
            while (true)
            {
                var read = await stream.ReadAsync(buffer, timeout.Token).ConfigureAwait(false);
                if (read == 0) break;
                if (bounded.Length + read > 4096) return ApiRateLimitStoreResult.Unavailable("invalid-response");
                bounded.Write(buffer, 0, read);
            }
            using var document = JsonDocument.Parse(bounded.ToArray(), new JsonDocumentOptions { MaxDepth = 8 });
            if (!document.RootElement.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Array || result.GetArrayLength() != 3)
                return ApiRateLimitStoreResult.Unavailable("invalid-response");
            var items = result.EnumerateArray().ToArray();
            if (!items[0].TryGetInt32(out var allowed) || allowed is not (0 or 1) ||
                !items[1].TryGetInt32(out var remaining) || remaining is < 0 or > 120 ||
                !items[2].TryGetInt32(out var retry) || retry is < 1 or > 60 ||
                (allowed == 0 && remaining != 0) || remaining >= policy.Requests ||
                retry > Math.Ceiling(policy.Window.TotalSeconds))
                return ApiRateLimitStoreResult.Unavailable("invalid-response");
            return ApiRateLimitStoreResult.Success(new ApiRateLimitDecision(allowed == 1, remaining, retry));
        }
        catch (OperationCanceledException)
        {
            return ApiRateLimitStoreResult.Unavailable("timeout");
        }
        catch (Exception exception) when (exception is HttpRequestException or IOException or JsonException or InvalidOperationException or ArgumentException or CryptographicException)
        {
            return ApiRateLimitStoreResult.Unavailable("store-unavailable");
        }
    }

    public void Dispose() => _http.Dispose();

    private static bool IsLoopback(Uri endpoint)
    {
        if (endpoint.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        var host = endpoint.Host.Trim('[', ']');
        return host == "127.0.0.1" || host == "::1";
    }
}
