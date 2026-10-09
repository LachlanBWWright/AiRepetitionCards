using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Recall.Api.Features.Auth;
using Recall.Api.Features.RateLimits;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Account;

/// <summary>Maps account export and deletion endpoints backed by Supabase.</summary>
public static class AccountEndpointMappings
{
    private const int PageSize = 1000;

    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/account/export", ExportAsync)
            .WithName("ExportAccount")
            .WithTags("Account")
            .WithApiRateLimit(ApiRateLimitScope.AccountOperations, "account");
        endpoints.MapPost("/api/v1/account/delete", DeleteAsync)
            .WithName("DeleteAccount")
            .WithTags("Account")
            .WithApiRateLimit(ApiRateLimitScope.AccountOperations, "account");
        return endpoints;
    }

    private static async Task<IResult> ExportAsync(
        HttpContext context,
        IConfiguration configuration,
        IHttpClientFactory clients,
        CancellationToken cancellationToken)
    {
        SetPrivateHeaders(context.Response);
        if (!IsSupabaseConfigured(configuration)) return Error("not-configured", StatusCodes.Status503ServiceUnavailable);
        var expectedOwner = context.Request.Headers["x-recall-workspace-owner"];
        if (expectedOwner.Count > 1 || (expectedOwner.Count == 1 && !IsWorkspaceOwner(expectedOwner[0])))
            return Error("workspace-account-changed", StatusCodes.Status409Conflict);
        var resolved = await SupabaseApiRequestContext.ResolveAsync(context, configuration);
        if (resolved is SupabaseApiRequestResult.Unauthenticated) return Error("unauthenticated", StatusCodes.Status401Unauthorized);
        if (resolved is SupabaseApiRequestResult.Unavailable) return Error("not-configured", StatusCodes.Status503ServiceUnavailable);
        var requestContext = ((SupabaseApiRequestResult.Authenticated)resolved).Context;
        if (expectedOwner.Count == 1 && !string.Equals(expectedOwner[0], requestContext.UserId.ToString("D"), StringComparison.OrdinalIgnoreCase))
            return Error("workspace-account-changed", StatusCodes.Status409Conflict);
        var projectUrl = requestContext.ProjectUrl;
        var publishableKey = requestContext.PublishableKey;

        using var client = clients.CreateClient("supabase-account");
        var ownerId = requestContext.UserId.ToString("D");
        var profiles = await ReadRows(client, projectUrl, publishableKey, context, "profiles", "user_id=eq." + ownerId, "user_id", cancellationToken);
        var areas = await ReadRows(client, projectUrl, publishableKey, context, "knowledge_areas", "owner_id=eq." + ownerId, "id", cancellationToken);
        var reviews = await ReadRows(client, projectUrl, publishableKey, context, "review_events", "user_id=eq." + ownerId, "id", cancellationToken);
        var schedules = await ReadRows(client, projectUrl, publishableKey, context, "scheduling_state", "user_id=eq." + ownerId, "card_id", cancellationToken);
        var syncChanges = await ReadRows(client, projectUrl, publishableKey, context, "sync_changes", "user_id=eq." + ownerId, "sequence", cancellationToken);
        var sessions = await ReadRows(client, projectUrl, publishableKey, context, "tutor_sessions", "user_id=eq." + ownerId, "id", cancellationToken);
        var messages = await ReadRows(client, projectUrl, publishableKey, context, "tutor_messages", "user_id=eq." + ownerId, "id", cancellationToken);
        var observations = await ReadRows(client, projectUrl, publishableKey, context, "ai_observations", "user_id=eq." + ownerId, "id", cancellationToken);
        var proposals = await ReadRows(client, projectUrl, publishableKey, context, "generated_card_proposals", "user_id=eq." + ownerId, "id", cancellationToken);
        var usage = await ReadRows(client, projectUrl, publishableKey, context, "tutor_ai_usage_events", "user_id=eq." + ownerId, "id", cancellationToken);
        if (new[] { profiles, areas, reviews, schedules, syncChanges, sessions, messages, observations, proposals, usage }.Any(rows => rows is null))
            return Error("account-export-unavailable", StatusCodes.Status502BadGateway);

        var areaIds = ReadIds(areas!, "id");
        var cards = await ReadRowsByIds(client, projectUrl, publishableKey, context, "cards", "knowledge_area_id", areaIds, "id", cancellationToken);
        var versions = await ReadRowsByIds(client, projectUrl, publishableKey, context, "knowledge_area_versions", "knowledge_area_id", areaIds, "id", cancellationToken);
        var objectives = await ReadRowsByIds(client, projectUrl, publishableKey, context, "learning_objectives", "knowledge_area_id", areaIds, "id", cancellationToken);
        var prerequisites = await ReadRowsByIds(client, projectUrl, publishableKey, context, "objective_prerequisites", "knowledge_area_id", areaIds, "objective_id", cancellationToken);
        if (cards is null || versions is null || objectives is null || prerequisites is null)
            return Error("account-export-unavailable", StatusCodes.Status502BadGateway);
        var cardIds = ReadIds(cards, "id");
        var revisions = await ReadRowsByIds(client, projectUrl, publishableKey, context, "card_revisions", "card_id", cardIds, "id", cancellationToken);
        var cardObjectives = await ReadRowsByIds(client, projectUrl, publishableKey, context, "card_objectives", "card_id", cardIds, "card_id", cancellationToken);
        if (revisions is null || cardObjectives is null)
            return Error("account-export-unavailable", StatusCodes.Status502BadGateway);

        var now = DateTimeOffset.UtcNow;
        var export = new
        {
            format = "recall-account-export",
            version = 1,
            exportedAt = now.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
            account = new { userId = ownerId, profile = profiles!.FirstOrDefault() },
            data = new
            {
                knowledgeAreas = areas,
                knowledgeAreaVersions = versions,
                learningObjectives = objectives,
                objectivePrerequisites = prerequisites,
                cards,
                cardRevisions = revisions,
                cardObjectives,
                reviewEvents = reviews,
                schedulingState = schedules,
                syncChanges,
                tutorSessions = sessions,
                tutorMessages = messages,
                aiObservations = observations,
                generatedCardProposals = proposals,
                aiUsage = usage
            }
        };
        var exportJson = JsonSerializer.SerializeToElement(export, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        if (!IsAccountExportValid(exportJson)) return Error("account-export-unavailable", StatusCodes.Status502BadGateway);
        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.ContentDisposition = $"attachment; filename=\"recall-account-export-{now:yyyy-MM-dd}.json\"";
        return Results.Json(exportJson);
    }

    private static async Task<IResult> DeleteAsync(
        HttpContext context,
        IConfiguration configuration,
        IHttpClientFactory clients,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        SetPrivateHeaders(context.Response);
        if (!IsSupabaseConfigured(configuration)) return Error("not-configured", StatusCodes.Status503ServiceUnavailable);
        var expectedOwner = context.Request.Headers["x-recall-workspace-owner"];
        if (expectedOwner.Count > 1 || (expectedOwner.Count == 1 && !IsWorkspaceOwner(expectedOwner[0])))
            return Error("workspace-account-changed", StatusCodes.Status409Conflict);
        var resolved = await SupabaseApiRequestContext.ResolveAsync(context, configuration);
        if (resolved is SupabaseApiRequestResult.Unauthenticated) return Error("unauthenticated", StatusCodes.Status401Unauthorized);
        if (resolved is SupabaseApiRequestResult.Unavailable) return Error("not-configured", StatusCodes.Status503ServiceUnavailable);
        var requestContext = ((SupabaseApiRequestResult.Authenticated)resolved).Context;
        if (expectedOwner.Count == 1 && !string.Equals(expectedOwner[0], requestContext.UserId.ToString("D"), StringComparison.OrdinalIgnoreCase))
            return Error("workspace-account-changed", StatusCodes.Status409Conflict);
        var origin = context.Request.Headers.Origin.ToString();
        var bearer = !context.Items.ContainsKey(SupabaseSsrBearerMiddleware.CookieSessionRequestItem) &&
            context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(origin))
        {
            if (!bearer) return Error("invalid-origin", StatusCodes.Status403Forbidden);
        }
        else if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsedOrigin) ||
                 !string.IsNullOrEmpty(parsedOrigin.UserInfo) || parsedOrigin.AbsolutePath != "/" ||
                 !string.IsNullOrEmpty(parsedOrigin.Query) || !string.IsNullOrEmpty(parsedOrigin.Fragment) ||
                 !Uri.TryCreate($"{context.Request.Scheme}://{context.Request.Host.Value}", UriKind.Absolute, out var requestOrigin) ||
                 !string.Equals(origin, requestOrigin.GetLeftPart(UriPartial.Authority), StringComparison.Ordinal) ||
                 !string.Equals(parsedOrigin.GetLeftPart(UriPartial.Authority), requestOrigin.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
        {
            return Error("invalid-origin", StatusCodes.Status403Forbidden);
        }

        byte[] bodyBytes;
        try
        {
            if (context.Request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) != true)
                return Error("confirmation-required", StatusCodes.Status400BadRequest);
            if (context.Request.ContentLength > 1024) return Error("request-too-large", StatusCodes.Status413PayloadTooLarge);
            using var boundedBody = new MemoryStream(1024);
            var buffer = new byte[512];
            while (true)
            {
                var read = await context.Request.Body.ReadAsync(buffer, cancellationToken);
                if (read == 0) break;
                if (boundedBody.Length + read > 1024)
                    return Error("request-too-large", StatusCodes.Status413PayloadTooLarge);
                await boundedBody.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            bodyBytes = boundedBody.ToArray();
        }
        catch (IOException) { return Error("confirmation-required", StatusCodes.Status400BadRequest); }
        try
        {
            using var body = JsonDocument.Parse(bodyBytes, new JsonDocumentOptions { MaxDepth = 4 });
            if (body.RootElement.ValueKind != JsonValueKind.Object ||
                !body.RootElement.TryGetProperty("confirmation", out var confirmation) ||
                confirmation.ValueKind != JsonValueKind.String || confirmation.GetString() != "DELETE")
                return Error("confirmation-required", StatusCodes.Status400BadRequest);
        }
        catch (JsonException) { return Error("confirmation-required", StatusCodes.Status400BadRequest); }

        var projectUrl = requestContext.ProjectUrl;
        var publishableKey = requestContext.PublishableKey;
        var serviceKey = configuration["SUPABASE_SERVICE_ROLE_KEY"]?.Trim();
        if (string.IsNullOrEmpty(serviceKey)) return Error("account-deletion-unavailable", StatusCodes.Status503ServiceUnavailable);
        using var client = clients.CreateClient("supabase-account");
        if (!await OpenAiIdentityCleanup.CleanupIfConfiguredAsync(
                configuration, client, requestContext.UserId, cancellationToken))
            return Error("account-deletion-cleanup-unavailable", StatusCodes.Status502BadGateway);

        using var eraseRequest = new HttpRequestMessage(HttpMethod.Post, new Uri(projectUrl, "/rest/v1/rpc/erase_account_data"));
        AddSupabaseHeaders(eraseRequest, publishableKey, serviceKey);
        eraseRequest.Content = JsonContent.Create(new { p_user_id = requestContext.UserId });
        HttpResponseMessage eraseResponse;
        try { eraseResponse = await client.SendAsync(eraseRequest, cancellationToken); }
        catch (HttpRequestException) { return Error("account-deletion-unavailable", StatusCodes.Status502BadGateway); }
        using (eraseResponse)
        {
            if (!eraseResponse.IsSuccessStatusCode) return Error("account-deletion-unavailable", StatusCodes.Status502BadGateway);
            try
            {
                await using var stream = await eraseResponse.Content.ReadAsStreamAsync(cancellationToken);
                using var result = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                if (result.RootElement.ValueKind != JsonValueKind.True) return Error("account-deletion-unavailable", StatusCodes.Status502BadGateway);
            }
            catch (JsonException) { return Error("account-deletion-unavailable", StatusCodes.Status502BadGateway); }
        }

        using var deleteRequest = new HttpRequestMessage(HttpMethod.Delete,
            new Uri(projectUrl, "/auth/v1/admin/users/" + requestContext.UserId.ToString("D")));
        AddSupabaseHeaders(deleteRequest, publishableKey, serviceKey);
        HttpResponseMessage deleteResponse;
        try { deleteResponse = await client.SendAsync(deleteRequest, cancellationToken); }
        catch (HttpRequestException) { return Error("account-deletion-unavailable", StatusCodes.Status502BadGateway); }
        using (deleteResponse)
        {
            if (!deleteResponse.IsSuccessStatusCode) return Error("account-deletion-unavailable", StatusCodes.Status502BadGateway);
        }
        await AuthEndpoints.SignOutAfterAccountDeletionAsync(
            context, projectUrl, publishableKey, requestContext.AccessToken, environment.IsProduction());
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        return Results.Json(new { deleted = true });
    }

    private static async Task<List<JsonElement>?> ReadRows(
        HttpClient client, Uri projectUrl, string publishableKey, HttpContext context,
        string table, string filter, string order, CancellationToken cancellationToken) =>
        await ReadRowsQuery(client, projectUrl, publishableKey, context, table,
            "select=*&" + filter + "&order=" + order, cancellationToken);

    private static async Task<List<JsonElement>?> ReadRowsByIds(
        HttpClient client, Uri projectUrl, string publishableKey, HttpContext context,
        string table, string column, IReadOnlyList<string> ids, string order, CancellationToken cancellationToken)
    {
        var result = new List<JsonElement>();
        foreach (var chunk in ids.Chunk(100))
        {
            var encoded = Uri.EscapeDataString("(" + string.Join(',', chunk.Select(id => "\"" + id + "\"")) + ")");
            var rows = await ReadRowsQuery(client, projectUrl, publishableKey, context, table,
                $"select=*&{column}=in.{encoded}&order={order}", cancellationToken);
            if (rows is null) return null;
            result.AddRange(rows);
        }
        return result;
    }

    private static async Task<List<JsonElement>?> ReadRowsQuery(
        HttpClient client, Uri projectUrl, string publishableKey, HttpContext context,
        string table, string query, CancellationToken cancellationToken)
    {
        var all = new List<JsonElement>();
        for (var offset = 0; ; offset += PageSize)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get,
                new Uri(projectUrl, $"/rest/v1/{table}?{query}&limit={PageSize}&offset={offset}"));
            AddSupabaseHeaders(request, publishableKey, context.Request.Headers.Authorization.ToString()[7..].Trim());
            request.Headers.TryAddWithoutValidation("Range-Unit", "items");
            request.Headers.TryAddWithoutValidation("Range", $"{offset}-{offset + PageSize - 1}");
            HttpResponseMessage response;
            try { response = await client.SendAsync(request, cancellationToken); }
            catch (HttpRequestException) { return null; }
            using (response)
            {
                if (!response.IsSuccessStatusCode) return null;
                try
                {
                    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                    if (document.RootElement.ValueKind != JsonValueKind.Array) return null;
                    foreach (var row in document.RootElement.EnumerateArray()) all.Add(row.Clone());
                    if (document.RootElement.GetArrayLength() < PageSize) return all;
                }
                catch (JsonException) { return null; }
            }
        }
    }

    private static List<string> ReadIds(IEnumerable<JsonElement> rows, string property) =>
        rows.Select(row => row.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null)
            .Where(value => value is not null).Select(value => value!).ToList();

    private static void AddSupabaseHeaders(HttpRequestMessage request, string key, string token)
    {
        request.Headers.TryAddWithoutValidation("apikey", key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    private static IResult Error(string error, int status) => Results.Json(new { error }, statusCode: status);

    private static bool IsWorkspaceOwner(string? value) =>
        value is not null && System.Text.RegularExpressions.Regex.IsMatch(value,
            "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private static bool IsSupabaseConfigured(IConfiguration configuration)
    {
        var url = (configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"])?.Trim();
        var key = (configuration["SUPABASE_PUBLISHABLE_KEY"] ?? configuration["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])?.Trim();
        return !string.IsNullOrWhiteSpace(key) &&
            Uri.TryCreate(url, UriKind.Absolute, out var parsed) &&
            (parsed.Scheme == Uri.UriSchemeHttps || parsed.Host == "localhost");
    }

    private static void SetPrivateHeaders(HttpResponse response)
    {
        response.Headers.CacheControl = "private, no-store, max-age=0";
        var vary = response.Headers.Vary.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        vary.Add("Authorization");
        vary.Add("Cookie");
        response.Headers.Vary = string.Join(", ", vary);
    }

    private static bool IsAccountExportValid(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object ||
            !value.TryGetProperty("format", out var format) || format.ValueKind != JsonValueKind.String || format.GetString() != "recall-account-export" ||
            !value.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var versionNumber) || versionNumber != 1 ||
            !value.TryGetProperty("exportedAt", out var exportedAt) || exportedAt.ValueKind != JsonValueKind.String ||
            exportedAt.GetString() is not { Length: <= 40 } timestamp ||
            !System.Text.RegularExpressions.Regex.IsMatch(timestamp, "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$") ||
            !DateTimeOffset.TryParse(timestamp, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out _) ||
            !value.TryGetProperty("account", out var account) || account.ValueKind != JsonValueKind.Object ||
            !account.TryGetProperty("userId", out var userId) || userId.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(userId.GetString()) || !account.TryGetProperty("profile", out var profile) ||
            (profile.ValueKind != JsonValueKind.Null && profile.ValueKind != JsonValueKind.Object) ||
            !value.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            return false;

        var collections = new[]
        {
            "knowledgeAreas", "knowledgeAreaVersions", "learningObjectives", "objectivePrerequisites",
            "cards", "cardRevisions", "cardObjectives", "reviewEvents", "schedulingState", "syncChanges",
            "tutorSessions", "tutorMessages", "aiObservations", "generatedCardProposals", "aiUsage"
        };
        foreach (var collection in collections)
        {
            if (!data.TryGetProperty(collection, out var rows) || rows.ValueKind != JsonValueKind.Array ||
                rows.EnumerateArray().Any(row => row.ValueKind != JsonValueKind.Object)) return false;
        }
        return true;
    }

}
