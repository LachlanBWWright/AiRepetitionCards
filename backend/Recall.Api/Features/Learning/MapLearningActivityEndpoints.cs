using Microsoft.AspNetCore.Routing;
using Recall.Api.Features.RateLimits;

namespace Recall.Api.Features.Learning;

public static class LearningActivityEndpoints
{
    public static IEndpointRouteBuilder MapLearningActivityEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var learning = endpoints.MapGroup("/api/v1/activities").WithTags("Learning activities");
        learning.MapGet("", (HttpContext http, LearningActivityOperations operations, CancellationToken token) => operations.ReadAsync(http, token))
            .WithApiRateLimit(ApiRateLimitScope.WorkspaceSync);
        learning.MapPost("", (HttpContext http, LearningActivityOperations operations, CancellationToken token) => operations.WriteAsync(http, token))
            .WithApiRateLimit(ApiRateLimitScope.WorkspaceSync);
        learning.MapPost("/assess", (HttpContext http, LearningActivityOperations operations, CancellationToken token) => operations.AssessAsync(http, token))
            .WithApiRateLimit(ApiRateLimitScope.TutorWrite);
        learning.MapPost("/question", (HttpContext http, LearningActivityOperations operations, CancellationToken token) => operations.QuestionAsync(http, token))
            .WithApiRateLimit(ApiRateLimitScope.TutorWrite);
        return endpoints;
    }
}
