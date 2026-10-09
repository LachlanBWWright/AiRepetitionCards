using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Recall.Api.Features.RateLimits;

/// <summary>Applies endpoint-declared limits after authentication and before endpoint/body binding.</summary>
public sealed class ApiRateLimitMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IApiRateLimitStore store, ApiRateLimitConfiguration configuration)
    {
        var policyMetadata = context.GetEndpoint()?.Metadata.GetMetadata<ApiRateLimitMetadata>();
        if (policyMetadata is null)
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        string? subject;
        if (policyMetadata.Anonymous)
        {
            subject = "anonymous-publication";
        }
        else
        {
            var userId = context.User.FindFirstValue("sub") ?? context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var subjectNamespace = ApiRateLimitScopeCompatibility.SubjectNamespace(policyMetadata.Namespace);
            subject = string.IsNullOrWhiteSpace(userId)
                ? null
                : subjectNamespace.Length == 0 ? userId : $"{subjectNamespace}:{userId}";
        }

        // Protected Next.js handlers authenticate before invoking the limiter. Preserve the
        // same auth response and avoid touching IP or account counters for unauthenticated calls.
        if (subject is null && !policyMetadata.Anonymous)
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        if (!ApiRateLimitPolicy.TryGet(policyMetadata.Scope, out var policy))
        {
            await WriteFailure(context, policyMetadata.Publication).ConfigureAwait(false);
            return;
        }
        var ipConfigured = !string.IsNullOrWhiteSpace(configuration.TrustedIpHeader) || !string.IsNullOrWhiteSpace(configuration.IpHmacSecret);
        if (ipConfigured)
        {
            if (string.IsNullOrWhiteSpace(configuration.TrustedIpHeader) ||
                !IsHeaderName(configuration.TrustedIpHeader) || string.IsNullOrWhiteSpace(configuration.IpHmacSecret) ||
                configuration.IpHmacSecret.Trim().Length < 32 || configuration.IpHmacSecret.Length > 4096)
            {
                await WriteFailure(context, policyMetadata.Publication).ConfigureAwait(false);
                return;
            }

            if (!context.Request.Headers.TryGetValue(configuration.TrustedIpHeader, out var values) || values.Count != 1 ||
                !RateLimitSubject.TryCanonicalIp(values[0] ?? "", out var canonicalIp))
            {
                await WriteFailure(context, policyMetadata.Publication).ConfigureAwait(false);
                return;
            }

            var metadataNamespace = ApiRateLimitScopeCompatibility.SubjectNamespace(policyMetadata.Namespace);
            var ipNamespace = policyMetadata.Anonymous ? "anonymous-publication" : metadataNamespace.Length == 0 ? "application" : metadataNamespace;
            var ipSubject = $"ip:{ipNamespace}:{RateLimitSubject.Hmac(canonicalIp, configuration.IpHmacSecret)}";
            var ipResult = await store.ConsumeAsync(ipSubject, policyMetadata.Scope, policy, context.RequestAborted).ConfigureAwait(false);
            if (!ipResult.IsSuccess)
            {
                await WriteFailure(context, policyMetadata.Publication).ConfigureAwait(false);
                return;
            }
            if (ipResult.Decision is { Allowed: false } ipDecision)
            {
                await WriteLimited(context, ipDecision, policyMetadata.Publication).ConfigureAwait(false);
                return;
            }
        }

        if (subject is null)
        {
            await next(context).ConfigureAwait(false);
            return;
        }

        var result = await store.ConsumeAsync(subject, policyMetadata.Scope, policy, context.RequestAborted).ConfigureAwait(false);
        if (!result.IsSuccess)
        {
            await WriteFailure(context, policyMetadata.Publication).ConfigureAwait(false);
            return;
        }
        if (result.Decision is { Allowed: false } decision)
        {
            await WriteLimited(context, decision, policyMetadata.Publication).ConfigureAwait(false);
            return;
        }
        await next(context).ConfigureAwait(false);
    }

    private static async Task WriteFailure(HttpContext context, bool publication) =>
        await WriteLimitResponse(context, StatusCodes.Status503ServiceUnavailable, 60,
            publication ? "publication-unavailable" : "rate-limit-unavailable", publication).ConfigureAwait(false);

    private static async Task WriteLimited(HttpContext context, ApiRateLimitDecision decision, bool publication) =>
        await WriteLimitResponse(context, StatusCodes.Status429TooManyRequests, decision.RetryAfterSeconds,
            publication ? "publication-unavailable" : "rate-limited", publication).ConfigureAwait(false);

    private static async Task WriteLimitResponse(HttpContext context, int status, int retry, string error, bool publication)
    {
        context.Response.StatusCode = status;
        context.Response.Headers.RetryAfter = retry.ToString(System.Globalization.CultureInfo.InvariantCulture);
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        context.Response.Headers.Vary = "Authorization, Cookie";
        context.Response.ContentType = "application/json";
        var body = publication
            ? JsonSerializer.Serialize(new { schemaVersion = 1, error, retryAfterSeconds = retry })
            : JsonSerializer.Serialize(new { error, retryAfterSeconds = retry });
        await context.Response.WriteAsync(body, context.RequestAborted).ConfigureAwait(false);
    }

    private static bool IsHeaderName(string value) => value.Length is > 0 and <= 127 &&
        char.IsAsciiLetterOrDigit(value[0]) &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');
}

public static class ApiRateLimitExtensions
{
    public static IServiceCollection AddRecallApiRateLimits(this IServiceCollection services, IConfiguration configuration, bool isDevelopment)
    {
        var options = new ApiRateLimitConfiguration
        {
            Mode = configuration["API_RATE_LIMIT_MODE"]?.Trim() ?? "",
            RestUrl = configuration["API_RATE_LIMIT_STORE_REST_URL"]?.Trim(),
            RestToken = configuration["API_RATE_LIMIT_STORE_REST_TOKEN"]?.Trim(),
            Prefix = configuration["API_RATE_LIMIT_STORE_PREFIX"]?.Trim() is { Length: > 0 } prefix ? prefix : "recall:api-rate-limit",
            TrustedIpHeader = configuration["API_RATE_LIMIT_TRUSTED_IP_HEADER"],
            IpHmacSecret = configuration["API_RATE_LIMIT_IP_HMAC_SECRET"],
            IsDevelopment = isDevelopment
        };
        services.AddSingleton(options);
        var mode = options.Mode.Length > 0 ? options.Mode : isDevelopment ? "memory" : "redis";
        if (mode == "memory") services.AddSingleton<IApiRateLimitStore, MemoryApiRateLimitStore>();
        else if (mode == "redis") services.AddSingleton<IApiRateLimitStore>(_ => new RedisRestApiRateLimitStore(options));
        else services.AddSingleton<IApiRateLimitStore>(_ => new UnavailableApiRateLimitStore());
        return services;
    }

    /// <summary>Place after authentication and before endpoint execution.</summary>
    public static IApplicationBuilder UseRecallApiRateLimits(this IApplicationBuilder app) => app.UseMiddleware<ApiRateLimitMiddleware>();

    public static TBuilder WithApiRateLimit<TBuilder>(this TBuilder builder, ApiRateLimitScope scope,
        string? subjectNamespace = null, bool publication = false, bool anonymous = false)
        where TBuilder : IEndpointConventionBuilder => builder.WithMetadata(
            new ApiRateLimitMetadata(scope, subjectNamespace, publication, IncludeTrustedIp: true, Anonymous: anonymous));
}

internal sealed class UnavailableApiRateLimitStore : IApiRateLimitStore
{
    public ValueTask<ApiRateLimitStoreResult> ConsumeAsync(string subject, ApiRateLimitScope scope,
        ApiRateLimitPolicy policy, CancellationToken cancellationToken) =>
        ValueTask.FromResult(ApiRateLimitStoreResult.Unavailable("configuration"));
}
