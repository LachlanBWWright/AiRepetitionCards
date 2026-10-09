namespace Recall.Api.Features.RateLimits;

public sealed record ApiRateLimitStoreResult(ApiRateLimitDecision? Decision, string? Failure)
{
    public bool IsSuccess => Decision is not null && Failure is null;
    public static ApiRateLimitStoreResult Success(ApiRateLimitDecision decision) => new(decision, null);
    public static ApiRateLimitStoreResult Unavailable(string reason) => new(null, reason);
}

public interface IApiRateLimitStore
{
    ValueTask<ApiRateLimitStoreResult> ConsumeAsync(
        string subject,
        ApiRateLimitScope scope,
        ApiRateLimitPolicy policy,
        CancellationToken cancellationToken);
}
