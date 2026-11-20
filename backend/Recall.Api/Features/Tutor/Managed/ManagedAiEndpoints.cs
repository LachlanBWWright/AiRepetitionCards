using System.Text.Json;
using Recall.Api.Contracts;
using Recall.Api.Features.RateLimits;

namespace Recall.Api.Features.Tutor;

public static class ManagedAiEndpoints
{
    public static IEndpointRouteBuilder MapManagedAiEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/ai/capabilities", async (HttpContext http, IConfiguration configuration, ManagedAiStore store, CancellationToken token) =>
        {
            http.Response.Headers.CacheControl = "private, no-store, max-age=0";
            http.Response.Headers.Vary = "Authorization, Cookie";
            var resolved = await SupabaseApiRequestContext.ResolveAsync(http, configuration);
            if (resolved is not SupabaseApiRequestResult.Authenticated auth) return Results.Json(new { error = "unauthenticated" }, statusCode: 401);
            if (!store.Enabled) return Results.Json(new { schemaVersion = 1, accountId = auth.Context.UserId, available = false,
                dailyLimitMicrousd = 0, usedMicrousd = 0, requestLimit = 0, requestsUsed = 0, expiresAt = (string?)null });
            var status = await store.RpcAsync("managed_ai_status", new { p_user_id = auth.Context.UserId }, token);
            return status is { ValueKind: JsonValueKind.Object } value && ContractBoundaryValidator.ValidateManagedAiStatus(value).IsValid && value.GetProperty("accountId").GetGuid() == auth.Context.UserId
                ? Results.Json(value) : Results.Json(new { error = "Managed AI access is temporarily unavailable." }, statusCode: 503);
        }).WithApiRateLimit(ApiRateLimitScope.TutorRead).WithTags("AI");
        return endpoints;
    }
}
