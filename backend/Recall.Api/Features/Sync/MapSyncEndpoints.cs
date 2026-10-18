using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Numerics;
using Microsoft.AspNetCore.Authentication;
using Recall.Api.Features.RateLimits;

namespace Recall.Api.Features.Sync;

/// <summary>Maps the authenticated workspace synchronization API.</summary>
public static class SyncEndpointMappings
{
    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/workspace", SyncHandlers.PushWorkspace).AllowAnonymous()
            .WithApiRateLimit(ApiRateLimitScope.WorkspaceSync, "workspace-sync").WithPrivateResponseHeaders();
        endpoints.MapPost("/api/v1/workspace/review-identities", SyncHandlers.ReadReviewIdentities).AllowAnonymous()
            .WithApiRateLimit(ApiRateLimitScope.WorkspaceSync, "workspace-sync").WithPrivateResponseHeaders();
        endpoints.MapPost("/api/v1/workspace/area-tombstones", SyncHandlers.DeleteAreas).AllowAnonymous()
            .WithApiRateLimit(ApiRateLimitScope.WorkspaceSync, "workspace-sync").WithPrivateResponseHeaders();
        endpoints.MapGet("/api/v1/workspace/media/{mediaId}", SyncHandlers.WorkspaceMedia).AllowAnonymous()
            .WithApiRateLimit(ApiRateLimitScope.PrivateMediaRead, "media-read").WithPrivateResponseHeaders();
        endpoints.MapPost("/api/v1/workspace/media/{mediaId}", SyncHandlers.WorkspaceMedia).AllowAnonymous()
            .WithApiRateLimit(ApiRateLimitScope.PrivateMediaWrite, "media-write").WithPrivateResponseHeaders();
        endpoints.MapMethods("/api/v1/sync", ["GET", "POST"], SyncHandlers.ReviewSync).AllowAnonymous()
            .WithApiRateLimit(ApiRateLimitScope.ReviewSync, "review-sync").WithPrivateResponseHeaders();
        return endpoints;
    }

    private static RouteHandlerBuilder WithPrivateResponseHeaders(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (filterContext, next) =>
        {
            var headers = filterContext.HttpContext.Response.Headers;
            headers.CacheControl = "private, no-store, max-age=0";
            var vary = headers["Vary"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
            vary.Add("Authorization");
            vary.Add("Cookie");
            headers["Vary"] = string.Join(", ", vary);
            return await next(filterContext);
        });
}

internal static partial class SyncHandlers
{
    private const long ContentBodyLimit = 5_000_000;
    private const long ReviewBodyLimit = 512_000;
    private const long SmallBodyLimit = 64_000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<IResult> PushWorkspace(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken cancellationToken)
    {
        var auth = await SyncRequestContext.Create(context, config, cancellationToken);
        if (auth.Error is not null) return auth.Error;
        var read = await ReadJson(context.Request, ContentBodyLimit, cancellationToken);
        if (!read.Ok) return Error(read.TooLarge ? "request-too-large" : "invalid-request", read.TooLarge ? 413 : 400);
        if (read.Value is not JsonObject body || IntegerNode(body["schemaVersion"]) != 1 || body["areas"] is not JsonArray areas || areas.Count > 100)
            return Error("invalid-request", 400);
        // The Next handler accepts omitted tombstones and normalizes them to an empty array.
        var tombstones = body["tombstones"] as JsonArray ?? (body.ContainsKey("tombstones") ? null : new JsonArray());
        if (tombstones is null || tombstones.Count > 2_000) return Error("invalid-request", 400);

        var areaIds = new HashSet<string>(StringComparer.Ordinal);
        var cardIds = new HashSet<string>(StringComparer.Ordinal);
        var objectiveIds = new HashSet<string>(StringComparer.Ordinal);
        var validated = new JsonArray();
        var cardCount = 0;
        foreach (var rawArea in areas)
        {
            if (rawArea is not JsonObject entry || entry["document"] is not JsonObject rawDocument ||
                NormalizeWorkspaceDocument(rawDocument) is not { } document ||
                !TryUuid(document["id"], out var areaId) || !areaIds.Add(areaId) ||
                !IsColor(StringNode(entry["color"])) ||
                !entry.ContainsKey("baseContentHash") ||
                entry["baseContentHash"] is not null && !IsHash(StringNode(entry["baseContentHash"])) ||
                !ValidateDocument(document, areaId, cardIds, objectiveIds, out var cards, out var objectives))
                return Error("invalid-content", 400);
            cardCount += cards;
            if (cardCount > 2_000) return Error("batch-too-large", 413);
            var contentHash = Hash(document);
            validated.Add(new JsonObject
            {
                ["id"] = areaId,
                ["title"] = document["title"]?.DeepClone(),
                ["description"] = document["description"]?.DeepClone(),
                ["language"] = document["language"]?.DeepClone(),
                ["color"] = entry["color"]!.DeepClone(),
                ["tags"] = document["tags"]?.DeepClone(),
                ["objectives"] = document["objectives"]!.DeepClone(),
                ["cards"] = AddRevisionIds(document["cards"]!.AsArray()),
                ["document"] = document.DeepClone(),
                ["versionId"] = Guid.NewGuid().ToString(),
                ["contentHash"] = contentHash,
                ["baseContentHash"] = entry["baseContentHash"]?.DeepClone()
            });
        }

        var tombstoneKeys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var tombstone in tombstones)
        {
            if (tombstone is not JsonObject item || !TryUuid(item["areaId"], out var areaId) || !TryUuid(item["cardId"], out var cardId) || !tombstoneKeys.Add($"{areaId}:{cardId}"))
                return Error("invalid-tombstones", 400);
        }
        foreach (var area in validated.OfType<JsonObject>())
        {
            var document = area["document"]!.AsObject();
            var areaId = document["id"]!.GetValue<string>();
            var removeIds = tombstones.OfType<JsonObject>()
                .Where(item => string.Equals(item["areaId"]?.GetValue<string>(), areaId, StringComparison.Ordinal))
                .Select(item => item["cardId"]!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
            if (removeIds.Count == 0) continue;
            var cards = document["cards"]!.AsArray().Where(card => card is not JsonObject cardObject || !removeIds.Contains(cardObject["id"]?.GetValue<string>() ?? "")).Select(card => card?.DeepClone()).ToArray();
            document["cards"] = new JsonArray(cards);
            area["cards"] = new JsonArray(area["cards"]!.AsArray().Where(card => card is not JsonObject cardObject || !removeIds.Contains(cardObject["id"]?.GetValue<string>() ?? "")).Select(card => card?.DeepClone()).ToArray());
            area["contentHash"] = Hash(document);
        }
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(auth.Value!.ProjectUrl, "/rest/v1/rpc/sync_workspace_content"));
        if (areaIds.Count > 0)
        {
            var deleted = await Postgrest(auth.Value, clients, "knowledge_areas?select=id&owner_id=eq." + auth.Value.UserId + "&deleted_at=not.is.null&id=in.(" + string.Join(',', areaIds) + ")&limit=100", cancellationToken);
            if (deleted is null || deleted.Value.ValueKind != JsonValueKind.Array) return Error("content-sync-failed", 502);
            if (deleted.Value.GetArrayLength() > 0) return Error("area-deleted-on-server", 409);
        }
        request.Headers.TryAddWithoutValidation("apikey", auth.Value.ApiKey);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.Value.AccessToken);
        request.Content = JsonContent.Create(new { p_areas = validated, p_tombstones = tombstones }, options: JsonOptions);
        using var response = await SendSafelyAsync(clients.CreateClient(), request, cancellationToken);
        if (response is null || !response.IsSuccessStatusCode) return Error("content-sync-failed", 502);
        bool? saved;
        try { saved = await response.Content.ReadFromJsonAsync<bool>(JsonOptions, cancellationToken); }
        catch (JsonException) { return Error("content-sync-failed", 502); }
        if (saved != true) return Error("content-conflict", 409);
        return Results.Json(new { schemaVersion = 1, syncedAreas = areas.Count, syncedCards = cardCount });
    }

    public static async Task<IResult> ReadReviewIdentities(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken cancellationToken)
    {
        var auth = await SyncRequestContext.Create(context, config, cancellationToken);
        if (auth.Error is not null) return auth.Error;
        var read = await ReadJson(context.Request, 8_192, cancellationToken);
        if (!read.Ok) return Error(read.TooLarge ? "request-too-large" : "invalid-request", read.TooLarge ? 413 : 400);
        if (context.Request.Query.Count > 0 || read.Value is not JsonObject body || IntegerNode(body["schemaVersion"]) != 1 || body["cardIds"] is not JsonArray ids || ids.Count is < 1 or > 100)
            return Error("invalid-request", 400);
        var cardIds = new List<string>();
        foreach (var id in ids) { if (!TryUuid(id, out var parsed)) return Error("invalid-request", 400); parsed = parsed.ToLowerInvariant(); if (cardIds.Contains(parsed, StringComparer.Ordinal)) return Error("invalid-request", 400); cardIds.Add(parsed); }
        var cards = await Postgrest(auth.Value!, clients, "cards?select=id,knowledge_area_id,deleted_at&id=in.(" + string.Join(',', cardIds) + ")&limit=100", cancellationToken);
        if (cards is null || cards.Value.ValueKind != JsonValueKind.Array) return Error("workspace-unavailable", 503);
        var cardRows = cards.Value.EnumerateArray().ToArray();
        if (cardRows.Any(row => !TryJsonString(row, "id", out var cardId) || !ValidUuidText(cardId) || !TryJsonString(row, "knowledge_area_id", out var knowledgeAreaId) || !ValidUuidText(knowledgeAreaId) || !row.TryGetProperty("deleted_at", out var deleted) || deleted.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)))
            return Error("workspace-unavailable", 503);
        var areaIds = cardRows.Select(row => row.GetProperty("knowledge_area_id").GetString()!).Distinct(StringComparer.Ordinal).ToArray();
        JsonElement? areaRows = areaIds.Length == 0 ? JsonDocument.Parse("[]").RootElement : await Postgrest(auth.Value!, clients, "knowledge_areas?select=id,deleted_at&owner_id=eq." + auth.Value!.UserId + "&id=in.(" + string.Join(',', areaIds) + ")&limit=100", cancellationToken);
        if (areaRows is null || areaRows.Value.ValueKind != JsonValueKind.Array) return Error("workspace-unavailable", 503);
        var areaRowValues = areaRows.Value.EnumerateArray().ToArray();
        if (areaRowValues.Any(row => !TryJsonString(row, "id", out var areaId) || !ValidUuidText(areaId) || !row.TryGetProperty("deleted_at", out var deleted) || deleted.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)) ||
            areaRowValues.Select(row => row.GetProperty("id").GetString()).Distinct(StringComparer.Ordinal).Count() != areaRowValues.Length)
            return Error("workspace-unavailable", 503);
        var ownedAreas = areaRowValues.ToDictionary(row => row.GetProperty("id").GetString()!, row => row.GetProperty("deleted_at").ValueKind != JsonValueKind.Null, StringComparer.Ordinal);
        var reviewCards = cardRows.Select(row =>
        {
            var areaId = row.GetProperty("knowledge_area_id").GetString()!;
            return ownedAreas.TryGetValue(areaId, out var areaDeleted) ? new { id = row.GetProperty("id").GetString(), areaId, deleted = row.GetProperty("deleted_at").ValueKind != JsonValueKind.Null || areaDeleted } : null;
        }).Where(row => row is not null).ToArray();
        if (reviewCards.Length > 100 || reviewCards.Select(row => row!.id).Distinct(StringComparer.Ordinal).Count() != reviewCards.Length)
            return Error("workspace-unavailable", 503);
        return Results.Json(new { schemaVersion = 1, ownerId = auth.Value!.UserId, reviewCards });
    }

    public static async Task<IResult> DeleteAreas(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken cancellationToken)
    {
        var auth = await SyncRequestContext.Create(context, config, cancellationToken);
        if (auth.Error is not null) return auth.Error;
        var read = await ReadJson(context.Request, SmallBodyLimit, cancellationToken);
        if (!read.Ok) return Error(read.TooLarge ? "request-too-large" : "invalid-request", read.TooLarge ? 413 : 400);
        if (read.Value is not JsonObject body || body["areaTombstones"] is not JsonArray rows || rows.Count > 100) return Error("invalid-tombstones", 400);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in rows) if (row is not JsonObject item || !TryUuid(item["areaId"], out var id) || !seen.Add(id) || !IsHash(StringNode(item["baseContentHash"]))) return Error("invalid-tombstones", 400);
        using var response = await Rpc(auth.Value!, clients, "tombstone_knowledge_areas", new { p_area_tombstones = rows }, cancellationToken);
        if (response is null || !response.IsSuccessStatusCode) return Error("tombstone-save-failed", 502);
        var saved = await response.Content.ReadFromJsonAsync<bool>(JsonOptions, cancellationToken);
        if (!saved) return Error("area-content-conflict", 409);
        return Results.Json(new { deletedAreaIds = rows.OfType<JsonObject>().Select(item => item["areaId"]!.GetValue<string>()).ToArray() });
    }

    public static async Task<IResult> ReviewSync(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken cancellationToken)
    {
        // The handlers share this dispatch point so all sync requests enforce the same identity binding.
        var auth = await SyncRequestContext.Create(context, config, cancellationToken);
        if (auth.Error is not null) return auth.Error;
        return context.Request.Method == HttpMethods.Get
            ? await PullReviews(context, auth.Value!, clients, cancellationToken)
            : await PushReviews(context, auth.Value!, clients, cancellationToken);
    }

    private static async Task<JsonElement?> Postgrest(SyncRequestContext auth, IHttpClientFactory clients, string query, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(auth.ProjectUrl, "/rest/v1/" + query)); SetHeaders(request, auth);
        using var response = await SendSafelyAsync(clients.CreateClient(), request, ct); if (response is null || !response.IsSuccessStatusCode) return null;
        try { using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct); return document.RootElement.Clone(); }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private static async Task<HttpResponseMessage?> Rpc(SyncRequestContext auth, IHttpClientFactory clients, string name, object body, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri(auth.ProjectUrl, "/rest/v1/rpc/" + name)); SetHeaders(request, auth); request.Content = JsonContent.Create(body, options: JsonOptions);
        try { return await SendSafelyAsync(clients.CreateClient(), request, ct); }
        finally { request.Dispose(); }
    }

    private static async Task<HttpResponseMessage?> SendSafelyAsync(HttpClient client, HttpRequestMessage request, CancellationToken ct)
    {
        try { return await client.SendAsync(request, ct); }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return null; }
        catch (IOException) { return null; }
    }

    private static void SetHeaders(HttpRequestMessage request, SyncRequestContext auth) { request.Headers.TryAddWithoutValidation("apikey", auth.ApiKey); request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.AccessToken); }
    private static bool ValidStoredChange(JsonElement row)
    {
        if (row.ValueKind != JsonValueKind.Object ||
            !TryJsonString(row, "operation_id", out var operationId) ||
            !TryJsonString(row, "entity_id", out var entityId) ||
            !TryJsonString(row, "entity_type", out var entityType) ||
            !TryJsonString(row, "operation", out var operation) ||
            !ValidTimestampProperty(row, "created_at") ||
            !row.TryGetProperty("payload", out var payload) || payload.ValueKind != JsonValueKind.Object)
            return false;

        if (entityType == "review_event")
        {
            return operation == "upsert" &&
                ValidUuidText(operationId) && ValidUuidText(entityId) &&
                TryJsonString(payload, "id", out var id) && ValidUuidText(id) && id == entityId && id == operationId &&
                TryJsonString(payload, "card_id", out var cardId) && ValidUuidText(cardId) && TryJsonString(payload, "device_id", out var deviceId) && ValidUuidText(deviceId) &&
                JsonPositiveInteger(payload, "device_sequence") &&
                JsonNullOrUuid(payload, "base_review_event_id") &&
                ValidTimestampProperty(payload, "reviewed_at_device") &&
                ValidTimestampProperty(payload, "effective_reviewed_at") &&
                TryJsonString(payload, "rating", out var rating) && IsRating(rating) &&
                JsonNullOrNonNegativeInteger(payload, "elapsed_ms") &&
                TryJsonString(payload, "scheduler_family", out var family) && family == "fsrs" &&
                TryJsonString(payload, "scheduler_version", out var version) && version.Length <= 80 &&
                JsonNullOrBoundedString(payload, "scheduler_parameter_set_id", 80) &&
                JsonNullOrHash(payload, "previous_state_hash");
        }

        if (entityType == "card")
        {
            return operation == "tombstone" &&
                ValidUuidText(entityId) && TryJsonString(payload, "id", out var id) && ValidUuidText(id) && id == entityId &&
                TryJsonString(payload, "areaId", out var cardAreaId) && ValidUuidText(cardAreaId) && ValidTimestampProperty(payload, "deletedAt");
        }

        return entityType == "area" && operation == "tombstone" &&
            ValidUuidText(entityId) && TryJsonString(payload, "id", out var areaId) && ValidUuidText(areaId) && areaId == entityId &&
            ValidTimestampProperty(payload, "deletedAt");
    }

    private static bool JsonNullOrUuid(JsonElement value, string name) => value.TryGetProperty(name, out var property) &&
        (property.ValueKind == JsonValueKind.Null || property.ValueKind == JsonValueKind.String && ValidUuidText(property.GetString() ?? string.Empty));

    private static bool ValidUuidText(string value) => System.Text.RegularExpressions.Regex.IsMatch(value, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private static bool ValidStoredReviewEvent(JsonElement row) => row.ValueKind == JsonValueKind.Object &&
        TryJsonString(row, "id", out _) && TryJsonString(row, "card_id", out _) && TryJsonString(row, "device_id", out _) &&
        row.TryGetProperty("device_sequence", out var sequence) && sequence.ValueKind == JsonValueKind.Number && sequence.TryGetDouble(out _) &&
        JsonNullOrNonEmptyString(row, "base_review_event_id") && TryJsonString(row, "reviewed_at_device", out _) &&
        TryJsonString(row, "effective_reviewed_at", out _) && TryJsonString(row, "rating", out _) &&
        row.TryGetProperty("elapsed_ms", out var elapsed) && elapsed.ValueKind is JsonValueKind.Null or JsonValueKind.Number &&
        TryJsonString(row, "scheduler_family", out _) && TryJsonString(row, "scheduler_version", out _) &&
        row.TryGetProperty("scheduler_parameter_set_id", out var parameterSet) && parameterSet.ValueKind is JsonValueKind.Null or JsonValueKind.String &&
        row.TryGetProperty("previous_state_hash", out var previousHash) && previousHash.ValueKind is JsonValueKind.Null or JsonValueKind.String;

    private static bool TryJsonString(JsonElement value, string name, out string text)
    {
        text = string.Empty;
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String)
            return false;
        text = property.GetString() ?? string.Empty;
        return text.Length > 0;
    }

    private static bool JsonPositiveInteger(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number &&
        property.TryGetInt64(out var number) && number > 0;

    private static bool JsonNullOrNonNegativeInteger(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) &&
        (property.ValueKind == JsonValueKind.Null || property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number) && number >= 0);

    private static bool JsonNullOrNonEmptyString(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) &&
        (property.ValueKind == JsonValueKind.Null || property.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(property.GetString()));

    private static bool JsonNullOrBoundedString(JsonElement value, string name, int maximumLength) =>
        value.TryGetProperty(name, out var property) &&
        (property.ValueKind == JsonValueKind.Null || property.ValueKind == JsonValueKind.String && (property.GetString()?.Length ?? maximumLength + 1) <= maximumLength);

    private static bool JsonNullOrHash(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) &&
        (property.ValueKind == JsonValueKind.Null || property.ValueKind == JsonValueKind.String && IsHash(property.GetString()));

    private static bool ValidTimestampProperty(JsonElement value, string name) =>
        value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String &&
        TryTimestamp(JsonValue.Create(property.GetString()), out _);

    private static bool IsColor(string? value) => value is not null && System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9a-fA-F]{6}$");
    private static bool IsHash(string? value) => value is not null && System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-fA-F0-9]{64}$");
    private static bool IsRating(string? value) => value is "again" or "hard" or "good" or "easy";
    private static string? StringNode(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
    private static int? IntegerNode(JsonNode? node) => node is JsonValue value && value.TryGetValue<int>(out var number) ? number : null;
    private static long? LongNode(JsonNode? node) => node is JsonValue value && value.TryGetValue<long>(out var number) ? number : null;
    private static bool TryUuid(JsonNode? node, out string value)
    {
        value = StringNode(node) ?? "";
        if (!System.Text.RegularExpressions.Regex.IsMatch(value, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return false;
        return true;
    }
    private static bool TryTimestamp(JsonNode? node, out DateTimeOffset value)
    {
        value = default;
        var input = StringNode(node);
        if (input is null || input.Length > 40 || !System.Text.RegularExpressions.Regex.IsMatch(input, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")) return false;
        if (!DateTimeOffset.TryParse(input, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out value)) return false;
        if (input.EndsWith('Z')) return true;
        var zone = input[^6..];
        var hours = int.Parse(zone[1..3], CultureInfo.InvariantCulture);
        var minutes = int.Parse(zone[4..6], CultureInfo.InvariantCulture);
        return hours <= 14 && minutes <= 59 && (hours != 14 || minutes == 0);
    }
    private static bool TrySequence(JsonElement value, out string sequence) { sequence = value.ToString(); return System.Text.RegularExpressions.Regex.IsMatch(sequence, "^[1-9][0-9]{0,19}$"); }
    private static BigInteger BigIntegerLike(string value) => BigInteger.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : BigInteger.Zero;
    private static string NormalizeTimestamp(string value) => DateTimeOffset.TryParse(value, out var parsed) ? parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) : value;
    private static JsonArray AddRevisionIds(JsonArray cards) => new(cards.Select(card => { var value = card?.DeepClone().AsObject(); if (value is not null) value["revisionId"] = Guid.NewGuid().ToString(); return (JsonNode?)value; }).ToArray());
    private static string Hash(JsonNode document) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(document))));
    private static string Canonical(JsonNode? value) => value switch { null => "null", JsonObject obj => "{" + string.Join(',', obj.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => JsonSerializer.Serialize(pair.Key) + ":" + Canonical(pair.Value))) + "}", JsonArray array => "[" + string.Join(',', array.Select(Canonical)) + "]", _ => value.ToJsonString() };

    private static async Task<JsonRead> ReadJson(HttpRequest request, long limit, CancellationToken cancellationToken)
    {
        if (request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) != true)
            return new(false, false, null);
        if (request.ContentLength > limit) return new(false, true, null);
        try { using var stream = new MemoryStream(); var buffer = new byte[8192]; int read; while ((read = await request.Body.ReadAsync(buffer, cancellationToken)) > 0) { if (stream.Length + read > limit) return new(false, true, null); await stream.WriteAsync(buffer.AsMemory(0, read), cancellationToken); } return new(true, false, JsonNode.Parse(stream.ToArray())); }
        catch (JsonException) { return new(false, false, null); }
        catch (IOException) { return new(false, false, null); }
    }
    private static IResult Error(string error, int status) => Results.Json(new { error }, statusCode: status);
}

internal sealed record SyncRequestContext(string UserId, string AccessToken, Uri ProjectUrl, string ApiKey)
{
    public static async Task<(SyncRequestContext? Value, IResult? Error)> Create(HttpContext context, IConfiguration config, CancellationToken ct)
    {
        AuthenticateResult auth;
        try
        {
            auth = await context.AuthenticateAsync("Bearer");
        }
        catch (InvalidOperationException)
        {
            return (null, Results.Json(new { error = "workspace-unavailable" }, statusCode: 503));
        }
        if (!auth.Succeeded || auth.Principal is null) return (null, Results.Json(new { error = "unauthorized" }, statusCode: 401));
        var userId = auth.Principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? auth.Principal.FindFirst("sub")?.Value;
        if (!Guid.TryParse(userId, out var userGuid)) return (null, Results.Json(new { error = "unauthorized" }, statusCode: 401));
        var owners = context.Request.Headers["x-recall-workspace-owner"];
        var owner = owners.Count == 1 ? owners[0] : owners.Count == 0 ? null : string.Empty;
        if (owner is not null && (!Guid.TryParse(owner, out var ownerGuid) || ownerGuid != userGuid)) return (null, Results.Json(new { error = "workspace-account-changed" }, statusCode: 409));
        var header = context.Request.Headers.Authorization.ToString(); var token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : "";
        var projectText = config["SUPABASE_URL"] ?? config["NEXT_PUBLIC_SUPABASE_URL"]; var apiKey = config["SUPABASE_PUBLISHABLE_KEY"] ?? config["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
        if (token.Length == 0 || !Uri.TryCreate(projectText, UriKind.Absolute, out var project) || string.IsNullOrWhiteSpace(apiKey)) return (null, Results.Json(new { error = "workspace-unavailable" }, statusCode: 503));
        return (new SyncRequestContext(userGuid.ToString(), token, project, apiKey), null);
    }
}
