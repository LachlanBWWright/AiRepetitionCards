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

internal static class SyncHandlers
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

    public static async Task<IResult> WorkspaceMedia(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken cancellationToken)
    {
        var auth = await SyncRequestContext.Create(context, config, cancellationToken);
        if (auth.Error is not null) return auth.Error;
        var mediaId = context.Request.RouteValues["mediaId"]?.ToString();
        var referenceHeaders = context.Request.Headers["x-recall-media-reference"];
        var reference = referenceHeaders.Count == 1 ? ReadMediaReference(referenceHeaders[0], mediaId) : null;
        if (reference is null) return Error("invalid-media-reference", 400);
        var objectUri = new Uri(auth.Value!.ProjectUrl, "/storage/v1/object/published-media/" + auth.Value.UserId + "/" + mediaId);
        if (HttpMethods.IsGet(context.Request.Method))
        {
            using var get = new HttpRequestMessage(HttpMethod.Get, objectUri); SetStorageHeaders(get, auth.Value);
            using var response = await SendSafelyAsync(clients.CreateClient(), get, cancellationToken);
            if (response is null || !response.IsSuccessStatusCode) return Error("media-not-found", 404);
            byte[] bytes;
            try { bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken); }
            catch (IOException) { return Error("media-not-found", 404); }
            if (!VerifyMedia(reference, bytes)) return Error("media-integrity-failed", 422);
            context.Response.Headers.CacheControl = "private, no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.Bytes(bytes, reference.MimeType, enableRangeProcessing: false);
        }
        if (context.Request.ContentLength is > 20_000_000) return Error("media-too-large", 413);
        if (context.Request.ContentType?.Split(';')[0].Trim().ToLowerInvariant() != "application/octet-stream")
            return Error("unsupported-media-type", 415);
        using var buffer = new MemoryStream(); var chunk = new byte[32_768]; int count;
        while ((count = await context.Request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + count > 20_000_000) return Error("media-too-large", 413);
            await buffer.WriteAsync(chunk.AsMemory(0, count), cancellationToken);
        }
        var bytesToUpload = buffer.ToArray();
        if (!VerifyMedia(reference, bytesToUpload)) return Error("media-integrity-failed", 422);
        using var upload = new HttpRequestMessage(HttpMethod.Post, objectUri); SetStorageHeaders(upload, auth.Value);
        upload.Headers.TryAddWithoutValidation("x-upsert", "false");
        upload.Content = new ByteArrayContent(bytesToUpload); upload.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(reference.MimeType);
        using var uploadResponse = await SendSafelyAsync(clients.CreateClient(), upload, cancellationToken);
        if (uploadResponse is null) return Error("media-storage-unavailable", 502);
        var created = uploadResponse.IsSuccessStatusCode;
        if (!created && (int)uploadResponse.StatusCode == 409)
        {
            using var existingRequest = new HttpRequestMessage(HttpMethod.Get, objectUri); SetStorageHeaders(existingRequest, auth.Value);
            using var existingResponse = await SendSafelyAsync(clients.CreateClient(), existingRequest, cancellationToken);
            if (existingResponse is null || !existingResponse.IsSuccessStatusCode)
                return Error("media-storage-conflict", 409);
            byte[] existingBytes;
            try { existingBytes = await existingResponse.Content.ReadAsByteArrayAsync(cancellationToken); }
            catch (IOException) { return Error("media-storage-conflict", 409); }
            if (!VerifyMedia(reference, existingBytes)) return Error("media-storage-conflict", 409);
        }
        else if (!created) return Error("media-storage-unavailable", 502);
        return Results.Json(new { reference }, statusCode: created ? 201 : 200);
    }

    private static void SetStorageHeaders(HttpRequestMessage request, SyncRequestContext auth)
    {
        request.Headers.TryAddWithoutValidation("apikey", auth.ApiKey);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.AccessToken);
    }

    private sealed record MediaReference(string Id, string MimeType, int ByteLength);
    private static MediaReference? ReadMediaReference(string? raw, string? pathId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(raw) || string.IsNullOrWhiteSpace(pathId)) return null;
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String || id.GetString() != pathId ||
                !root.TryGetProperty("mimeType", out var mime) || mime.ValueKind != JsonValueKind.String ||
                !root.TryGetProperty("byteLength", out var length) || !length.TryGetInt32(out var byteLength) || byteLength is < 1 or > 20_000_000)
                return null;
            var mimeType = mime.GetString()!;
            if (mimeType is not ("image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav") || !System.Text.RegularExpressions.Regex.IsMatch(pathId, "^[a-f0-9]{64}$")) return null;
            return new MediaReference(pathId, mimeType, byteLength);
        }
        catch (JsonException) { return null; }
    }

    private static bool VerifyMedia(MediaReference reference, byte[] bytes)
    {
        if (bytes.Length != reference.ByteLength || Convert.ToHexStringLower(SHA256.HashData(bytes)) != reference.Id) return false;
        return reference.MimeType switch
        {
            "image/png" => bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            "image/jpeg" => bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
            "image/gif" => bytes.Length >= 6 && Encoding.ASCII.GetString(bytes, 0, 6) is "GIF87a" or "GIF89a",
            "image/webp" => bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP",
            "audio/wav" => bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WAVE",
            "audio/ogg" => bytes.Length >= 4 && Encoding.ASCII.GetString(bytes, 0, 4) == "OggS",
            "audio/mpeg" => bytes.Length >= 3 && Encoding.ASCII.GetString(bytes, 0, 3) == "ID3" || bytes.Length >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0,
            _ => false
        };
    }

    private static async Task<IResult> PushReviews(HttpContext context, SyncRequestContext auth, IHttpClientFactory clients, CancellationToken cancellationToken)
    {
        var read = await ReadJson(context.Request, ReviewBodyLimit, cancellationToken);
        if (!read.Ok) return Error(read.TooLarge ? "request-too-large" : "invalid-request", read.TooLarge ? 413 : 400);
        if (read.Value is not JsonObject body || IntegerNode(body["schemaVersion"]) != 1 || !TryUuid(body["deviceId"], out var deviceId) || body["operations"] is not JsonArray operations || operations.Count > 100)
            return Error("invalid-request", 400);
        var receivedAt = DateTimeOffset.UtcNow;
        receivedAt = receivedAt.AddTicks(-(receivedAt.Ticks % TimeSpan.TicksPerMillisecond));
        var rows = new JsonArray();
        foreach (var operation in operations)
        {
            if (operation is not JsonObject item || !TryUuid(item["id"], out var id) || !TryUuid(item["cardId"], out var cardId) ||
                LongNode(item["deviceSequence"]) is not > 0 and <= 9_007_199_254_740_991L || !TryTimestamp(item["reviewedAtDevice"], out var deviceTime) ||
                !TryTimestamp(item["effectiveReviewedAt"], out _) || !IsRating(StringNode(item["rating"])) ||
                StringNode(item["schedulerFamily"]) != "fsrs" || StringNode(item["schedulerVersion"]) is not { Length: > 0 and <= 80 } ||
                !item.ContainsKey("baseReviewEventId") || !item.ContainsKey("elapsedMs") ||
                !item.ContainsKey("schedulerParameterSetId") || !item.ContainsKey("previousStateHash") ||
                item["baseReviewEventId"] is not null && !TryUuid(item["baseReviewEventId"], out _) ||
                item["elapsedMs"] is not null && IntegerNode(item["elapsedMs"]) is null or < 0 ||
                item["schedulerParameterSetId"] is not null && StringNode(item["schedulerParameterSetId"]) is not { Length: <= 80 } ||
                item["previousStateHash"] is not null && !IsHash(StringNode(item["previousStateHash"]))) return Error("invalid-request", 400);
            var elapsed = IntegerNode(item["elapsedMs"]);
            var normalizedDeviceTime = DateTimeOffset.FromUnixTimeMilliseconds(deviceTime.ToUnixTimeMilliseconds());
            var effective = normalizedDeviceTime > receivedAt ? receivedAt : normalizedDeviceTime;
            rows.Add(new JsonObject
            {
                ["id"] = id,
                ["user_id"] = auth.UserId,
                ["card_id"] = cardId,
                ["device_id"] = deviceId,
                ["device_sequence"] = LongNode(item["deviceSequence"]),
                ["base_review_event_id"] = item["baseReviewEventId"]?.DeepClone(),
                ["reviewed_at_device"] = item["reviewedAtDevice"]!.DeepClone(),
                ["effective_reviewed_at"] = effective.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
                ["rating"] = item["rating"]!.DeepClone(),
                ["elapsed_ms"] = item["elapsedMs"]?.DeepClone(),
                ["scheduler_family"] = "fsrs",
                ["scheduler_version"] = item["schedulerVersion"]!.DeepClone(),
                ["scheduler_parameter_set_id"] = item["schedulerParameterSetId"]?.DeepClone(),
                ["previous_state_hash"] = item["previousStateHash"]?.DeepClone()
            });
        }
        if (rows.Count > 0)
        {
            var save = await UpsertReviews(auth, clients, rows, cancellationToken);
            if (save == 409) return Results.Json(new { schemaVersion = 1, acceptedIds = Array.Empty<string>(), conflicts = operations.OfType<JsonObject>().Select(item => new { id = item["id"]?.GetValue<string>(), reason = "device-sequence-conflict" }), cursor = await Cursor(auth, clients, cancellationToken) ?? "0" }, statusCode: 409);
            if (save != 0) return Error("sync-write-failed", 502);
        }
        var ids = operations.OfType<JsonObject>().Select(item => item["id"]!.GetValue<string>()).ToArray();
        var savedRows = ids.Length == 0 ? JsonDocument.Parse("[]").RootElement : await Postgrest(auth, clients, "review_events?select=id,card_id,device_id,device_sequence,base_review_event_id,reviewed_at_device,effective_reviewed_at,rating,elapsed_ms,scheduler_family,scheduler_version,scheduler_parameter_set_id,previous_state_hash&user_id=eq." + auth.UserId + "&id=in.(" + string.Join(',', ids) + ")", cancellationToken);
        if (savedRows is null || savedRows.Value.ValueKind != JsonValueKind.Array) return Error("sync-read-failed", 502);
        var savedRowValues = savedRows.Value.EnumerateArray().ToArray();
        if (savedRowValues.Any(row => !ValidStoredReviewEvent(row))) return Error("sync-response-invalid", 502);
        var byId = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var row in savedRowValues) byId[row.GetProperty("id").GetString()!] = row;
        var accepted = new List<object>(); var conflicts = new List<object>();
        foreach (var op in operations.OfType<JsonObject>())
        {
            var id = op["id"]!.GetValue<string>();
            if (byId.TryGetValue(id, out var stored) && ReviewMatches(stored, op, deviceId)) accepted.Add(new { id, cardId = stored.GetProperty("card_id").GetString(), effective = stored.GetProperty("effective_reviewed_at").GetString() });
            else conflicts.Add(new { id, reason = "id-collision" });
        }
        var cursor = await Cursor(auth, clients, cancellationToken);
        if (cursor is null) return Error("sync-cursor-failed", 502);
        var cards = accepted.Count == 0 ? JsonDocument.Parse("[]").RootElement : await Postgrest(auth, clients, "cards?select=id,knowledge_area_id&id=in.(" + string.Join(',', accepted.Select(item => ((dynamic)item).cardId)) + ")", cancellationToken);
        if (cards is null || cards.Value.ValueKind != JsonValueKind.Array) return Error("sync-read-failed", 502);
        var cardIdentityRows = cards.Value.EnumerateArray().ToArray();
        if (cardIdentityRows.Any(row => !TryJsonString(row, "id", out var cardId) || !ValidUuidText(cardId) || !TryJsonString(row, "knowledge_area_id", out var knowledgeAreaId) || !ValidUuidText(knowledgeAreaId)))
            return Error("sync-response-invalid", 502);
        var areaByCard = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var row in cardIdentityRows) areaByCard[row.GetProperty("id").GetString()!] = row.GetProperty("knowledge_area_id").GetString()!;
        // Build the response from stored rows so idempotent retries return the canonical event.
        var eventResults = new List<object>();
        foreach (var item in accepted)
        {
            var value = (dynamic)item; var row = byId[(string)value.id]; var cardId = row.GetProperty("card_id").GetString()!;
            if (!areaByCard.TryGetValue(cardId, out var areaId)) return Error("sync-response-invalid", 502);
            eventResults.Add(new { id = (string)value.id, areaId, cardId, deviceId = row.GetProperty("device_id").GetString(), deviceSequence = row.GetProperty("device_sequence").GetInt64(), baseReviewEventId = row.GetProperty("base_review_event_id").ValueKind == JsonValueKind.Null ? null : row.GetProperty("base_review_event_id").GetString(), reviewedAtDevice = row.GetProperty("reviewed_at_device").GetString(), effectiveReviewedAt = NormalizeTimestamp(row.GetProperty("effective_reviewed_at").GetString()!), ratedAt = NormalizeTimestamp(row.GetProperty("effective_reviewed_at").GetString()!), rating = row.GetProperty("rating").GetString(), elapsedMs = row.GetProperty("elapsed_ms").ValueKind == JsonValueKind.Null ? (int?)null : row.GetProperty("elapsed_ms").GetInt32(), schedulerFamily = row.GetProperty("scheduler_family").GetString(), schedulerVersion = row.GetProperty("scheduler_version").GetString(), schedulerParameterSetId = row.GetProperty("scheduler_parameter_set_id").ValueKind == JsonValueKind.Null ? null : row.GetProperty("scheduler_parameter_set_id").GetString(), previousStateHash = row.GetProperty("previous_state_hash").ValueKind == JsonValueKind.Null ? null : row.GetProperty("previous_state_hash").GetString() });
        }
        return Results.Json(new { schemaVersion = 1, acceptedIds = accepted.Select(item => (string)((dynamic)item).id).ToArray(), acceptedReviewEvents = eventResults, conflicts, cursor }, statusCode: conflicts.Count > 0 ? 200 : 200);
    }

    private static async Task<IResult> PullReviews(HttpContext context, SyncRequestContext auth, IHttpClientFactory clients, CancellationToken cancellationToken)
    {
        if (context.Request.Query.Keys.Any(key => key != "cursor") || context.Request.Query["cursor"].Count > 1) return Error("invalid-cursor", 400);
        var cursor = context.Request.Query["cursor"].FirstOrDefault() ?? "0";
        if (!System.Text.RegularExpressions.Regex.IsMatch(cursor, @"^\d{1,20}$")) return Error("invalid-cursor", 400);
        var rows = await Postgrest(auth, clients, "sync_changes?select=sequence,operation_id,entity_type,entity_id,operation,payload,created_at&user_id=eq." + auth.UserId + "&sequence=gt." + cursor + "&order=sequence.asc&limit=101", cancellationToken);
        if (rows is null || rows.Value.ValueKind != JsonValueKind.Array) return Error("sync-read-failed", 502);
        var changes = rows.Value.EnumerateArray().ToArray(); var hasMore = changes.Length > 100; var page = changes.Take(100).ToArray();
        var prior = BigIntegerLike(cursor);
        foreach (var row in changes)
        {
            if (!ValidStoredChange(row) || !TrySequence(row.GetProperty("sequence"), out var sequence) || BigIntegerLike(sequence) <= prior) return Error("sync-response-invalid", 502);
            prior = BigIntegerLike(sequence);
        }
        var reviewCardIds = page.Where(row => row.GetProperty("entity_type").GetString() == "review_event").Select(row => row.GetProperty("payload").GetProperty("card_id").GetString()!).Distinct(StringComparer.Ordinal).ToArray();
        var cardRows = reviewCardIds.Length == 0 ? JsonDocument.Parse("[]").RootElement : await Postgrest(auth, clients, "cards?select=id,knowledge_area_id&id=in.(" + string.Join(',', reviewCardIds) + ")", cancellationToken);
        if (cardRows is null || cardRows.Value.ValueKind != JsonValueKind.Array) return Error("sync-read-failed", 502);
        var areaByCard = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var card in cardRows.Value.EnumerateArray())
        {
            if (!TryJsonString(card, "id", out var cardId) || !TryJsonString(card, "knowledge_area_id", out var areaId))
                return Error("sync-response-invalid", 502);
            areaByCard[cardId] = areaId;
        }
        var responseChanges = new List<object>();
        foreach (var row in page)
        {
            var entityType = row.GetProperty("entity_type").GetString(); var payload = row.GetProperty("payload"); var entityId = row.GetProperty("entity_id").GetString()!;
            object outputPayload;
            if (entityType == "review_event")
            {
                var id = payload.GetProperty("id").GetString()!; var cardId = payload.GetProperty("card_id").GetString()!;
                if (id != entityId || id != row.GetProperty("operation_id").GetString() || !areaByCard.TryGetValue(cardId, out var areaId)) return Error("sync-response-invalid", 502);
                var effective = NormalizeTimestamp(payload.GetProperty("effective_reviewed_at").GetString()!);
                outputPayload = new { id, areaId, cardId, ratedAt = effective, rating = payload.GetProperty("rating").GetString(), schedulerFamily = payload.GetProperty("scheduler_family").GetString(), schedulerVersion = payload.GetProperty("scheduler_version").GetString(), deviceId = payload.GetProperty("device_id").GetString(), deviceSequence = payload.GetProperty("device_sequence").GetInt64(), baseReviewEventId = payload.GetProperty("base_review_event_id").ValueKind == JsonValueKind.Null ? null : payload.GetProperty("base_review_event_id").GetString(), reviewedAtDevice = payload.GetProperty("reviewed_at_device").GetString(), effectiveReviewedAt = effective, elapsedMs = payload.GetProperty("elapsed_ms").ValueKind == JsonValueKind.Null ? (int?)null : payload.GetProperty("elapsed_ms").GetInt32(), schedulerParameterSetId = payload.GetProperty("scheduler_parameter_set_id").ValueKind == JsonValueKind.Null ? null : payload.GetProperty("scheduler_parameter_set_id").GetString(), previousStateHash = payload.GetProperty("previous_state_hash").ValueKind == JsonValueKind.Null ? null : payload.GetProperty("previous_state_hash").GetString() };
            }
            else
            {
                if (payload.GetProperty("id").GetString() != entityId) return Error("sync-response-invalid", 502);
                outputPayload = entityType == "card"
                    ? new { id = payload.GetProperty("id").GetString(), areaId = payload.GetProperty("areaId").GetString(), deletedAt = payload.GetProperty("deletedAt").GetString() }
                    : new { id = payload.GetProperty("id").GetString(), deletedAt = payload.GetProperty("deletedAt").GetString() };
            }
            responseChanges.Add(new { sequence = row.GetProperty("sequence").ToString(), operationId = row.GetProperty("operation_id").GetString(), entityType, entityId, operation = row.GetProperty("operation").GetString(), payload = outputPayload, createdAt = row.GetProperty("created_at").GetString() });
        }
        var nextCursor = page.Length == 0 ? cursor : page[^1].GetProperty("sequence").ToString();
        return Results.Json(new { schemaVersion = 1, changes = responseChanges, cursor = nextCursor, hasMore });
    }

    private static async Task<int> UpsertReviews(SyncRequestContext auth, IHttpClientFactory clients, JsonArray rows, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(auth.ProjectUrl, "/rest/v1/review_events?on_conflict=id"));
        SetHeaders(request, auth); request.Headers.TryAddWithoutValidation("Prefer", "resolution=ignore-duplicates,return=minimal"); request.Content = JsonContent.Create(rows, options: JsonOptions);
        using var response = await SendSafelyAsync(clients.CreateClient(), request, ct);
        return response is null ? 503 : response.IsSuccessStatusCode ? 0 : (int)response.StatusCode;
    }

    private static bool ReviewMatches(JsonElement stored, JsonObject operation, string deviceId)
    {
        var equal = (string column, JsonNode? input) => input is null
            ? stored.GetProperty(column).ValueKind == JsonValueKind.Null
            : stored.GetProperty(column).ToString().Equals(input.ToString(), StringComparison.Ordinal);
        return stored.GetProperty("id").GetString() == operation["id"]?.GetValue<string>() && stored.GetProperty("card_id").GetString() == operation["cardId"]?.GetValue<string>() && stored.GetProperty("device_id").GetString() == deviceId && stored.GetProperty("device_sequence").GetInt64() == operation["deviceSequence"]!.GetValue<long>() && equal("base_review_event_id", operation["baseReviewEventId"]) && equal("rating", operation["rating"]) && equal("elapsed_ms", operation["elapsedMs"]) && equal("scheduler_family", operation["schedulerFamily"]) && equal("scheduler_version", operation["schedulerVersion"]) && equal("scheduler_parameter_set_id", operation["schedulerParameterSetId"]) && equal("previous_state_hash", operation["previousStateHash"]) && DateTimeOffset.TryParse(stored.GetProperty("reviewed_at_device").GetString(), out var savedTime) && DateTimeOffset.TryParse(operation["reviewedAtDevice"]?.GetValue<string>(), out var inputTime) && savedTime.ToUnixTimeMilliseconds() == inputTime.ToUnixTimeMilliseconds();
    }

    private static async Task<string?> Cursor(SyncRequestContext auth, IHttpClientFactory clients, CancellationToken ct)
    {
        var row = await Postgrest(auth, clients, "sync_changes?select=sequence&user_id=eq." + auth.UserId + "&order=sequence.desc&limit=1", ct);
        if (row is null || row.Value.ValueKind != JsonValueKind.Array) return null;
        if (row.Value.GetArrayLength() == 0) return "0";
        var first = row.Value[0];
        return first.ValueKind == JsonValueKind.Object && first.TryGetProperty("sequence", out var storedSequence) &&
            TrySequence(storedSequence, out var sequence) ? sequence : null;
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

    private static bool ValidateDocument(JsonObject doc, string id, HashSet<string> cardIds, HashSet<string> objectiveIds, out int cards, out int objectives)
    {
        cards = 0; objectives = 0;
        if (StringNode(doc["schemaVersion"]) != "1.0.0" || !string.Equals(StringNode(doc["id"]), id, StringComparison.Ordinal) || string.IsNullOrWhiteSpace(StringNode(doc["title"])) || StringNode(doc["title"])!.Length > 80 || string.IsNullOrWhiteSpace(StringNode(doc["language"])) || doc["objectives"] is not JsonArray objectiveArray || doc["cards"] is not JsonArray cardArray || doc["tags"] is not JsonArray tags || doc["ai"] is not JsonObject ai || !doc.ContainsKey("description") || !doc.ContainsKey("licence") || !ai.ContainsKey("tutorInstructions") || !ai.ContainsKey("quizInstructions") || !ai.ContainsKey("cardGenerationInstructions")) return false;
        if (doc["sourceId"] is not null && StringNode(doc["sourceId"]) is null ||
            doc["description"] is not null && StringNode(doc["description"]) is null ||
            doc["licence"] is not null && StringNode(doc["licence"]) is null ||
            doc["attribution"] is not null && StringNode(doc["attribution"]) is null ||
            StringNode(doc["attribution"]) is { Length: > 500 } ||
            StringNode(doc["forkedFromVersionId"]) is { Length: > 80 } ||
            tags.Any(tag => StringNode(tag) is null)) return false;
        if (objectiveArray.Count > 200 || cardArray.Count > 500) return false;
        objectives = objectiveArray.Count; cards = cardArray.Count;
        var localObjectives = new HashSet<string>(StringComparer.Ordinal);
        foreach (var objective in objectiveArray)
        {
            if (objective is not JsonObject item || !TryUuid(item["id"], out var objectiveId) || !localObjectives.Add(objectiveId) || !objectiveIds.Add(objectiveId) || string.IsNullOrWhiteSpace(StringNode(item["title"])) || item["prerequisiteIds"] is not JsonArray prerequisites || !item.ContainsKey("description")) return false;
            if (item["description"] is not null && StringNode(item["description"]) is null) return false;
            foreach (var prerequisite in prerequisites) if (!TryUuid(prerequisite, out _)) return false;
        }
        foreach (var objective in objectiveArray.OfType<JsonObject>())
            foreach (var prerequisite in objective["prerequisiteIds"]!.AsArray())
                if (!TryUuid(prerequisite, out var prerequisiteId) || !localObjectives.Contains(prerequisiteId)) return false;
        foreach (var card in cardArray)
        {
            if (card is not JsonObject item || !TryUuid(item["id"], out var cardId) || !cardIds.Add(cardId) || item["objectiveIds"] is not JsonArray links) return false;
            foreach (var link in links) if (!TryUuid(link, out var linkedObjectiveId) || !localObjectives.Contains(linkedObjectiveId)) return false;
            if (item["tags"] is not JsonArray cardTags || cardTags.Any(tag => StringNode(tag) is null) ||
                StringNode(item["origin"]) is not ("authored" or "imported" or "ai-generated") ||
                item["sourceId"] is not null && StringNode(item["sourceId"]) is null ||
                item["media"] is not null && (item["media"] is not JsonArray media || media.Count > 20 || media.Any(reference => !ValidMediaReference(reference)))) return false;
            if (StringNode(item["kind"]) == "basic") { if (string.IsNullOrWhiteSpace(StringNode(item["front"])) || string.IsNullOrWhiteSpace(StringNode(item["back"]))) return false; }
            else if (StringNode(item["kind"]) == "cloze")
            {
                var text = StringNode(item["text"]);
                var deletionIndex = IntegerNode(item["deletionIndex"]);
                if (!ValidCloze(text, deletionIndex)) return false;
            }
            else return false;
        }
        return StringNode(ai["tutorInstructions"]) is { Length: <= 2_000 } &&
            (ai["quizInstructions"] is null || StringNode(ai["quizInstructions"]) is { Length: <= 2_000 }) &&
            (ai["cardGenerationInstructions"] is null || StringNode(ai["cardGenerationInstructions"]) is { Length: <= 2_000 });
    }

    private static JsonObject? NormalizeWorkspaceDocument(JsonObject input)
    {
        var document = (JsonObject)input.DeepClone();
        KeepOnly(document, "schemaVersion", "id", "sourceId", "title", "description", "language", "objectives", "ai", "cards", "tags", "licence", "attribution", "forkedFromVersionId");
        if (document["objectives"] is JsonArray objectives)
            foreach (var objective in objectives.OfType<JsonObject>())
                KeepOnly(objective, "id", "title", "description", "prerequisiteIds", "sourceId");
        if (document["ai"] is JsonObject ai)
            KeepOnly(ai, "tutorInstructions", "quizInstructions", "cardGenerationInstructions");
        if (document["cards"] is JsonArray cards)
        {
            foreach (var card in cards.OfType<JsonObject>())
            {
                if (StringNode(card["kind"]) == "basic") KeepOnly(card, "kind", "id", "front", "back", "objectiveIds", "media", "tags", "origin", "sourceId");
                else KeepOnly(card, "kind", "id", "text", "deletionIndex", "objectiveIds", "media", "tags", "origin", "sourceId");
                if (card["media"] is JsonArray media)
                    foreach (var reference in media.OfType<JsonObject>()) KeepOnly(reference, "id", "mimeType", "byteLength");
            }
        }
        return document;
    }

    private static void KeepOnly(JsonObject value, params string[] allowed)
    {
        var set = new HashSet<string>(allowed, StringComparer.Ordinal);
        foreach (var key in value.Select(pair => pair.Key).ToArray())
            if (!set.Contains(key)) value.Remove(key);
    }

    private static bool ValidMediaReference(JsonNode? value)
    {
        if (value is not JsonObject reference) return false;
        var id = StringNode(reference["id"]);
        var mime = StringNode(reference["mimeType"]);
        var length = IntegerNode(reference["byteLength"]);
        return id is not null && System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-f0-9]{64}$") &&
            mime is "image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav" &&
            length is > 0 and <= 20_000_000;
    }

    private static bool ValidCloze(string? text, int? deletionIndex)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 20_000 || deletionIndex is < 1 or > 20) return false;
        var pattern = new System.Text.RegularExpressions.Regex(@"\{\{c([1-9]|1[0-9]|20)::([^{}]+?)\}\}", System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        var matches = pattern.Matches(text);
        if (matches.Count == 0) return false;
        var selectedExists = deletionIndex is null;
        var offset = 0;
        foreach (System.Text.RegularExpressions.Match match in matches)
        {
            var prefix = text[offset..match.Index];
            if (prefix.Contains("{{", StringComparison.Ordinal) || prefix.Contains("}}", StringComparison.Ordinal)) return false;
            var contents = match.Groups[2].Value;
            var separator = contents.IndexOf("::", StringComparison.Ordinal);
            var answer = separator < 0 ? contents : contents[..separator];
            var hint = separator < 0 ? null : contents[(separator + 2)..];
            if (string.IsNullOrWhiteSpace(answer) || hint is not null && (string.IsNullOrWhiteSpace(hint) || hint.Contains("::", StringComparison.Ordinal))) return false;
            var index = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
            if (index == deletionIndex) selectedExists = true;
            offset = match.Index + match.Length;
        }
        var suffix = text[offset..];
        return selectedExists && !suffix.Contains("{{", StringComparison.Ordinal) && !suffix.Contains("}}", StringComparison.Ordinal);
    }

    private sealed record JsonRead(bool Ok, bool TooLarge, JsonNode? Value);
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
