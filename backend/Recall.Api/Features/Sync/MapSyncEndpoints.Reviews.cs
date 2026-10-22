using System.Globalization;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Recall.Api.Features.Sync;

internal static partial class SyncHandlers
{
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
                item["schedulerParameterSetId"] is not null && StringNode(item["schedulerParameterSetId"]) is not { Length: <= 2048 } ||
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
}
