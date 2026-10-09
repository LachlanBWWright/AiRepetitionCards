using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Recall.Api;

/// <summary>Adds a request ID and sanitizes unexpected API failures without logging request data.</summary>
public sealed class ApiRequestObservationMiddleware(
    RequestDelegate next,
    IConfiguration configuration,
    ILogger<ApiRequestObservationMiddleware> logger)
{
    private readonly bool _loggingEnabled = string.Equals(
        configuration["RECALL_HTTP_LOGGING"], "true", StringComparison.OrdinalIgnoreCase);

    public async Task InvokeAsync(HttpContext context)
    {
        var requestId = Guid.NewGuid().ToString("D");
        var startedAt = Stopwatch.GetTimestamp();
        var unexpectedFailure = false;
        context.Response.Headers["x-request-id"] = requestId;

        try
        {
            await next(context).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            unexpectedFailure = true;
            if (_loggingEnabled)
            {
                logger.LogError(exception, "Unhandled API request failure {RequestId}", requestId);
            }
            if (!context.Response.HasStarted)
            {
                context.Response.Clear();
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                context.Response.ContentType = "application/json";
                context.Response.Headers.CacheControl = "private, no-store, max-age=0";
                context.Response.Headers.Vary = "Authorization, Cookie";
                context.Response.Headers["x-request-id"] = requestId;
                await JsonSerializer.SerializeAsync(
                    context.Response.Body,
                    new { error = "request-failed", requestId },
                    cancellationToken: context.RequestAborted).ConfigureAwait(false);
            }
        }
        finally
        {
            if (_loggingEnabled)
            {
                try
                {
                    var endpoint = context.GetEndpoint();
                    var operation = endpoint?.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ??
                        (endpoint is RouteEndpoint route ? route.RoutePattern.RawText : null) ?? "unmatched";
                    var durationMs = Math.Max(0, Stopwatch.GetElapsedTime(startedAt).TotalMilliseconds);
                    var eventJson = JsonSerializer.Serialize(new
                    {
                        schemaVersion = 1,
                        requestId,
                        operation,
                        status = context.Response.StatusCode,
                        durationMs,
                        timestamp = DateTimeOffset.UtcNow,
                        unexpectedFailure
                    });
                    logger.LogInformation("{HttpTelemetryEvent}", eventJson);
                }
                catch (Exception)
                {
                }
            }
        }
    }
}

public static class ApiRequestObservationExtensions
{
    public static IApplicationBuilder UseApiRequestObservation(this IApplicationBuilder app) =>
        app.UseMiddleware<ApiRequestObservationMiddleware>();
}
