using System.Net;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Recall.Api;
using Recall.Api.Features.Account;
using Recall.Api.Features.Auth;
using Recall.Api.Features.Publishing;
using Recall.Api.Features.RateLimits;
using Recall.Api.Features.Sync;
using Recall.Api.Features.Tutor;
using Recall.Api.Contracts;
using Recall.Infrastructure.SupabaseAuth;
using Recall.Infrastructure.SupabaseWorkspaceRead;

var builder = WebApplication.CreateBuilder(args);

var forwardedHeaders = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedHost | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1,
    RequireHeaderSymmetry = true
};
var trustedProxyValues = builder.Configuration["RECALL_TRUSTED_PROXY_IPS"]?
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];
var trustedProxyAddresses = trustedProxyValues.Select(value => IPAddress.TryParse(value, out var address) ? address : null).ToArray();
if (trustedProxyAddresses.Length > 0 && trustedProxyAddresses.All(address => address is not null))
{
    forwardedHeaders.KnownIPNetworks.Clear();
    forwardedHeaders.KnownProxies.Clear();
    foreach (var address in trustedProxyAddresses)
    {
        forwardedHeaders.KnownProxies.Add(address!);
    }
}

var projectUrl = builder.Configuration["SUPABASE_URL"] ?? builder.Configuration["NEXT_PUBLIC_SUPABASE_URL"];
var publishableKey = builder.Configuration["SUPABASE_PUBLISHABLE_KEY"] ?? builder.Configuration["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
var audience = builder.Configuration["SUPABASE_JWT_AUDIENCE"] ?? "authenticated";
var requireHttpsMetadata = !builder.Environment.IsDevelopment();
var authConfigured = SupabaseJwtConfiguration.TryCreate(
    projectUrl,
    audience,
    requireHttpsMetadata,
    out var jwtConfiguration);

builder.Services.AddHttpClient<SupabaseWorkspaceSnapshotReader>();
builder.Services.AddHttpClient<TutorPrivacyOperations>();
builder.Services.AddTransient<TutorApiOperations>();
builder.Services.AddHttpClient<OpenAiTutorProvider>();
builder.Services.AddTransient<ITutorProvider>(services => services.GetRequiredService<OpenAiTutorProvider>());
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.OperationFilter<ApiContractOperationFilter>();
    options.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.OpenApiSecurityScheme
    {
        Name = "Authorization",
        In = Microsoft.OpenApi.ParameterLocation.Header,
        Type = Microsoft.OpenApi.SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        Description = "Supabase access token. Browser requests may instead be authenticated by the server-side Supabase session cookie."
    });
    options.AddSecurityDefinition("SupabaseSessionCookie", new Microsoft.OpenApi.OpenApiSecurityScheme
    {
        Name = "Cookie",
        In = Microsoft.OpenApi.ParameterLocation.Header,
        Type = Microsoft.OpenApi.SecuritySchemeType.ApiKey,
        Description = "Browser authentication is supplied through the Cookie request header using the project-specific, HttpOnly Supabase SSR session cookie (including chunked cookie names)."
    });
});
builder.Services.AddAuthorization();
builder.Services.AddRecallApiRateLimits(builder.Configuration, builder.Environment.IsDevelopment());
if (authConfigured && jwtConfiguration is not null)
{
    builder.Services.AddSupabaseJwtBearer(jwtConfiguration);
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseForwardedHeaders(forwardedHeaders);
app.UseApiRequestObservation();
app.UseSupabaseSsrBearer();
if (authConfigured)
{
    app.UseAuthentication();
}
app.UseRecallApiRateLimits();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new HealthResponse("ok")))
    .WithName("GetHealth")
    .WithTags("Health");

app.MapAuthEndpoints(projectUrl, publishableKey, app.Environment.IsProduction());
app.MapAccountEndpoints();
app.MapSyncEndpoints();
app.MapPublishingEndpoints();
app.MapTutorEndpoints();

app.MapGet("/api/v1/workspace", async (
    HttpContext context,
    SupabaseWorkspaceSnapshotReader workspaceReader,
    CancellationToken cancellationToken) =>
{
    context.Response.Headers.CacheControl = "private, no-store, max-age=0";
    context.Response.Headers.Vary = "Authorization, Cookie";
    if (!authConfigured || string.IsNullOrWhiteSpace(publishableKey) ||
        !Uri.TryCreate(projectUrl, UriKind.Absolute, out var projectUri))
    {
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        return Results.Json(new { error = "workspace-unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    var authentication = await context.AuthenticateAsync("Bearer");
    if (!authentication.Succeeded || authentication.Principal is null)
    {
        return Results.Json(new { error = "unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    var identity = SupabaseUserIdentity.TryResolve(authentication.Principal);
    var authorization = context.Request.Headers.Authorization.ToString();
    var accessToken = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        ? authorization[7..].Trim()
        : string.Empty;
    if (identity is null || string.IsNullOrWhiteSpace(accessToken))
    {
        return Results.Json(new { error = "unauthorized" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    if (context.Request.Headers.TryGetValue("x-recall-workspace-owner", out var workspaceOwners) &&
        (workspaceOwners.Count != 1 || !Guid.TryParse(workspaceOwners[0], out var assertedOwner) ||
         assertedOwner != identity.UserId))
    {
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        return Results.Json(new { error = "workspace-account-changed" }, statusCode: StatusCodes.Status409Conflict);
    }

    var rows = await workspaceReader.ReadAsync(
        new SupabaseReadContext(projectUri, publishableKey, accessToken, identity.UserId),
        cancellationToken);
    if (rows is Recall.Infrastructure.SupabaseWorkspaceRead.Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Failure readFailure)
    {
        var status = readFailure.Error.Kind switch
        {
            WorkspaceReadFailureKind.Unauthorized => StatusCodes.Status401Unauthorized,
            WorkspaceReadFailureKind.Forbidden => StatusCodes.Status403Forbidden,
            WorkspaceReadFailureKind.InvalidConfiguration => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status502BadGateway
        };
        return Results.Json(new { error = "workspace-read-failed" }, statusCode: status);
    }
    var workspaceRows = ((Recall.Infrastructure.SupabaseWorkspaceRead.Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Success)rows).Value;

    var versionByArea = new Dictionary<string, WorkspaceAreaVersionRow>(StringComparer.OrdinalIgnoreCase);
    foreach (var version in workspaceRows.Versions)
    {
        if (!versionByArea.ContainsKey(version.KnowledgeAreaId))
        {
            versionByArea.Add(version.KnowledgeAreaId, version);
        }
    }

    var areas = new List<object>(workspaceRows.Areas.Length);
    foreach (var area in workspaceRows.Areas)
    {
        if (!versionByArea.TryGetValue(area.Id, out var version) ||
            version.Content.ValueKind != System.Text.Json.JsonValueKind.Object ||
            !version.Content.TryGetProperty("id", out var documentId) ||
            documentId.ValueKind != System.Text.Json.JsonValueKind.String ||
            !string.Equals(documentId.GetString(), area.Id, StringComparison.OrdinalIgnoreCase) ||
            !System.Text.RegularExpressions.Regex.IsMatch(area.Color, "^#[0-9a-fA-F]{6}$"))
        {
            return Results.Json(new { error = "workspace-response-invalid" }, statusCode: StatusCodes.Status502BadGateway);
        }

        areas.Add(new { document = version.Content, color = area.Color, contentHash = version.ContentHash });
    }

    var snapshot = new WorkspaceSnapshotResponse(
        1,
        identity.UserId,
        areas,
        workspaceRows.DeletedAreas.Select(area => area.Id).ToArray());
    var wireSnapshot = System.Text.Json.JsonSerializer.SerializeToElement(
        snapshot,
        new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
    if (!ContractBoundaryValidator.ValidateWorkspaceSnapshot(wireSnapshot).IsValid)
    {
        return Results.Json(new { error = "workspace-response-invalid" }, statusCode: StatusCodes.Status502BadGateway);
    }
    context.Response.Headers.CacheControl = "private, no-store, max-age=0";
    return Results.Json(wireSnapshot);
})
    .AllowAnonymous()
    .WithName("GetWorkspace")
    .WithTags("Workspace")
    .WithApiRateLimit(ApiRateLimitScope.WorkspaceSync);

app.Run();

internal sealed record HealthResponse(string Status);
internal sealed record WorkspaceSnapshotResponse(int SchemaVersion, Guid OwnerId, IReadOnlyList<object> Areas, IReadOnlyList<string> DeletedAreaIds);

public partial class Program { }
