namespace Recall.Api.Features.RateLimits;

/// <summary>Single-process fixed-window store. Capacity failures are closed and expired keys are collected.</summary>
public sealed class MemoryApiRateLimitStore : IApiRateLimitStore
{
    private sealed record Bucket(long ExpiresAt, int Count);
    private readonly object _gate = new();
    private readonly Dictionary<string, Bucket> _buckets = new(StringComparer.Ordinal);
    private readonly int _maximumBuckets;
    private readonly TimeProvider _timeProvider;

    public MemoryApiRateLimitStore(int maximumBuckets = 10_000, TimeProvider? timeProvider = null)
    {
        _maximumBuckets = maximumBuckets > 0 ? maximumBuckets : 10_000;
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public ValueTask<ApiRateLimitStoreResult> ConsumeAsync(
        string subject,
        ApiRateLimitScope scope,
        ApiRateLimitPolicy policy,
        CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested)
            return ValueTask.FromResult(ApiRateLimitStoreResult.Unavailable("cancelled"));
        if (string.IsNullOrWhiteSpace(subject) || subject.Length > 128 || ApiRateLimitScopeCompatibility.ContractName(scope).Length == 0 || policy.Requests is < 1 or > 120 ||
            policy.Window < TimeSpan.FromSeconds(1) || policy.Window > TimeSpan.FromMinutes(1) || policy.Window.TotalMilliseconds % 1 != 0)
            return ValueTask.FromResult(ApiRateLimitStoreResult.Unavailable("invalid-request"));

        var now = _timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
        var width = checked((long)policy.Window.TotalMilliseconds);
        var key = System.Text.Json.JsonSerializer.Serialize(new object[] { subject, ApiRateLimitScopeCompatibility.ContractName(scope) });
        lock (_gate)
        {
            if (!_buckets.TryGetValue(key, out var previous) || previous.ExpiresAt <= now)
            {
                if (_buckets.Count >= _maximumBuckets)
                {
                    foreach (var expired in _buckets.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
                        _buckets.Remove(expired);
                    if (_buckets.Count >= _maximumBuckets)
                        return ValueTask.FromResult(ApiRateLimitStoreResult.Unavailable("capacity"));
                }
                previous = new Bucket(now + width, 0);
            }

            var allowed = previous.Count < policy.Requests;
            var count = allowed ? previous.Count + 1 : previous.Count;
            _buckets[key] = previous with { Count = count };
            var remainingMilliseconds = previous.ExpiresAt - now;
            var retry = Math.Clamp((int)Math.Ceiling(remainingMilliseconds / 1000d), 1, 60);
            return ValueTask.FromResult(ApiRateLimitStoreResult.Success(
                new ApiRateLimitDecision(allowed, Math.Max(0, policy.Requests - count), retry)));
        }
    }
}
