using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Recall.Api.Features.RateLimits;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Tutor;

/// <summary>ASP.NET Core endpoints for tutor-history privacy and bounded transcript retention.</summary>
public static class TutorEndpointMappings
{
    public static IEndpointRouteBuilder MapTutorEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var privacy = endpoints.MapGroup("/api/v1/tutor/privacy").WithTags("Tutor privacy");
        privacy.MapGet("", (HttpContext context, IConfiguration config, TutorPrivacyOperations operations) => GetPolicy(context, config, operations)).WithApiRateLimit(ApiRateLimitScope.PrivacyPolicyRead, "account");
        privacy.MapDelete("", (HttpContext context, IConfiguration config, TutorPrivacyOperations operations, CancellationToken token) => DeleteHistory(context, config, operations, token)).WithApiRateLimit(ApiRateLimitScope.WorkspaceSync, "account");

        var tutor = endpoints.MapGroup("/api/v1/tutor").WithTags("Tutor");
        tutor.MapGet("", async (HttpContext context, TutorApiOperations operations, CancellationToken token) =>
        {
            context.Response.Headers.CacheControl = "private, no-store, max-age=0";
            return await operations.ReadSessionAsync(context, token);
        }).WithApiRateLimit(ApiRateLimitScope.TutorRead);
        tutor.MapPost("", async (HttpContext context, TutorApiOperations operations, CancellationToken token) =>
        {
            context.Response.Headers.CacheControl = "private, no-store, max-age=0";
            return await operations.ExecuteActionAsync(context, token);
        }).WithApiRateLimit(ApiRateLimitScope.TutorWrite);
        tutor.MapPatch("", async (HttpContext context, TutorApiOperations operations, CancellationToken token) =>
        {
            context.Response.Headers.CacheControl = "private, no-store, max-age=0";
            return await operations.ResolveProposalAsync(context, token);
        }).WithApiRateLimit(ApiRateLimitScope.TutorWrite);

        var retention = endpoints.MapGroup("/api/internal/tutor-retention").WithTags("Internal retention");
        retention.MapGet("", (HttpContext context, TutorPrivacyOperations operations, CancellationToken token) =>
            RunRetention(context, operations, "CRON_SECRET", token));
        retention.MapPost("", (HttpContext context, TutorPrivacyOperations operations, CancellationToken token) =>
            RunRetention(context, operations, "TUTOR_RETENTION_JOB_SECRET", token));
        retention.MapMethods("", ["HEAD"], (HttpContext context) =>
        {
            context.Response.Headers.Allow = "GET, POST";
            SetPrivateHeaders(context);
            return Results.StatusCode(StatusCodes.Status405MethodNotAllowed);
        })
            .WithMetadata(new Microsoft.AspNetCore.Routing.HttpMethodMetadata(["HEAD"]));
        return endpoints;
    }

    private static async Task<IResult> GetPolicy(HttpContext context, IConfiguration configuration, TutorPrivacyOperations operations)
    {
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        SetPrivateHeaders(context);
        var resolved = await SupabaseApiRequestContext.ResolveAsync(context, configuration);
        if (resolved is not SupabaseApiRequestResult.Authenticated)
            return PrivateJson(new { error = resolved is SupabaseApiRequestResult.Unavailable ? "privacy-unavailable" : "unauthorized" },
                resolved is SupabaseApiRequestResult.Unavailable ? 503 : 401);
        var raw = Environment.GetEnvironmentVariable("TUTOR_TRANSCRIPT_RETENTION_DAYS")?.Trim() ?? "30";
        if (!TryReadRetentionDays(raw, out var days))
            return PrivateJson(new { error = "privacy-unavailable" }, 503);
        return PrivateJson(new
        {
            schemaVersion = 1,
            retentionDays = days == 0 ? (int?)null : days,
            deletionAvailable = operations.IsAdminConfigured
        }, 200);
    }

    private static async Task<IResult> DeleteHistory(
        HttpContext context,
        IConfiguration configuration,
        TutorPrivacyOperations operations,
        CancellationToken cancellationToken)
    {
        SetPrivateHeaders(context);
        var resolved = await SupabaseApiRequestContext.ResolveAsync(context, configuration);
        if (resolved is not SupabaseApiRequestResult.Authenticated authenticated)
            return PrivateJson(new { error = resolved is SupabaseApiRequestResult.Unavailable ? "privacy-unavailable" : "unauthorized" },
                resolved is SupabaseApiRequestResult.Unavailable ? 503 : 401);

        var origin = context.Request.Headers.Origin.ToString();
        var bearer = context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase);
        if (!string.IsNullOrEmpty(origin))
        {
            var requestOrigin = Uri.TryCreate($"{context.Request.Scheme}://{context.Request.Host.Value}", UriKind.Absolute, out var requestUri)
                ? requestUri.GetLeftPart(UriPartial.Authority)
                : string.Empty;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri) ||
                originUri.GetLeftPart(UriPartial.Authority) != requestOrigin)
                return PrivateJson(new { error = "invalid-origin" }, 403);
        }
        else if (!bearer)
        {
            return PrivateJson(new { error = "invalid-origin" }, 403);
        }

        var contentType = context.Request.ContentType?.Split(';', 2)[0].Trim();
        if (!string.Equals(contentType, "application/json", StringComparison.OrdinalIgnoreCase))
            return PrivateJson(new { error = "invalid-content-type" }, 400);
        if (context.Request.ContentLength is > 1_024)
            return PrivateJson(new { error = "request-too-large" }, 413);
        DeleteRequest? request;
        try
        {
            using var body = new MemoryStream();
            var buffer = new byte[512];
            while (true)
            {
                var read = await context.Request.Body.ReadAsync(buffer, cancellationToken);
                if (read == 0) break;
                if (body.Length + read > 1_024)
                    return PrivateJson(new { error = "request-too-large" }, 413);
                await body.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            body.Position = 0;
            request = await JsonSerializer.DeserializeAsync<DeleteRequest>(body,
                new JsonSerializerOptions(JsonSerializerDefaults.Web) { MaxDepth = 8 }, cancellationToken);
        }
        catch (JsonException)
        {
            return PrivateJson(new { error = "invalid-json" }, 400);
        }
        catch (IOException)
        {
            return PrivateJson(new { error = "unreadable" }, 400);
        }
        if (request?.Confirmation != "DELETE_TUTOR_HISTORY")
            return PrivateJson(new { error = "confirmation-required" }, 400);

        var deleted = await operations.DeleteOwnedHistoryAsync(authenticated.Context.UserId, cancellationToken);
        return deleted is Result<int, TutorPrivacyFailure>.Failure
            ? PrivateJson(new { error = "privacy-unavailable" }, 502)
            : PrivateJson(new
            {
                schemaVersion = 1,
                deleted = true,
                deletedSessions = ((Result<int, TutorPrivacyFailure>.Success)deleted).Value
            }, 200);
    }

    private static async Task<IResult> RunRetention(
        HttpContext context,
        TutorPrivacyOperations operations,
        string secretName,
        CancellationToken cancellationToken)
    {
        SetPrivateHeaders(context);
        var secret = Environment.GetEnvironmentVariable(secretName);
        if (string.IsNullOrEmpty(secret) || secret.Length is < 32 or > 4096 ||
            secret.Any(character => character is < (char)0x21 or > (char)0x7e))
            return PrivateJson(new { error = "retention-unavailable" }, 503);

        var expected = Encoding.UTF8.GetBytes("Bearer " + secret);
        var supplied = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());
        var expectedDigest = SHA256.HashData(expected);
        var suppliedDigest = SHA256.HashData(supplied);
        if (!CryptographicOperations.FixedTimeEquals(expectedDigest, suppliedDigest))
            return PrivateJson(new { error = "unauthenticated" }, 401);

        var rawDays = Environment.GetEnvironmentVariable("TUTOR_TRANSCRIPT_RETENTION_DAYS")?.Trim() ?? "30";
        if (!TryReadRetentionDays(rawDays, out var days))
            return PrivateJson(new { error = "retention-unavailable" }, 503);
        var rawBatch = Environment.GetEnvironmentVariable("TUTOR_RETENTION_BATCH_SIZE")?.Trim() ?? "250";
        if (rawBatch.Length is < 1 or > 4 || rawBatch[0] is < '1' or > '9' || rawBatch.Any(character => character is < '0' or > '9') ||
            !int.TryParse(rawBatch, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var batchSize) || batchSize > 1_000)
            return PrivateJson(new { error = "retention-unavailable" }, 503);
        if (days == 0)
            return PrivateJson(new { schemaVersion = 1, deletedSessions = 0 }, 200);

        var cutoff = DateTimeOffset.UtcNow.AddDays(-days);
        var result = await operations.PurgeExpiredAsync(cutoff, batchSize, cancellationToken);
        return result is Result<int, TutorPrivacyFailure>.Failure
            ? PrivateJson(new { error = "retention-unavailable" }, 502)
            : PrivateJson(new
            {
                schemaVersion = 1,
                deletedSessions = ((Result<int, TutorPrivacyFailure>.Success)result).Value
            }, 200);
    }

    private static void SetPrivateHeaders(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        context.Response.Headers.Vary = "Authorization, Cookie";
    }

    private static IResult PrivateJson<T>(T value, int status) => Results.Json(value, statusCode: status);

    private static bool TryReadRetentionDays(string raw, out int days) =>
        int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out days) &&
        days is >= 0 and <= 365 && raw.Length <= 3 && (raw.Length == 1 || !raw.StartsWith('0'));

    private sealed record DeleteRequest(string? Confirmation);
}
