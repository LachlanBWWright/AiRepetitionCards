using System.Text.Json;
using System.Text.Json.Nodes;
namespace Recall.Api.Features.Sync;
internal static partial class SyncHandlers
{
    public static async Task<IResult> StudySync(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken ct)
    {
        var auth = await SyncRequestContext.Create(context, config, ct);
        if (auth.Error is not null) return auth.Error;
        object payload = new { };
        var rpc = "read_workspace_study";
        if (context.Request.Method == "POST")
        {
            var read = await ReadJson(context.Request, ContentBodyLimit, ct);
            if (!read.Ok || read.Value is not JsonObject body || IntegerNode(body["revision"]) is not { } revision || revision < 0 || body["document"] is not JsonObject document || !ValidStudyDocument(document))
                return Error("invalid-request", read.TooLarge ? 413 : 400);
            payload = new { p_revision = revision, p_document = document };
            rpc = "sync_workspace_study";
        }
        using var response = await Rpc(auth.Value!, clients, rpc, payload, ct);
        if (response is null || !response.IsSuccessStatusCode) return Error("study-storage-unavailable", 502);
        try
        {
            var result = await JsonNode.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (result is null) return Error("study-conflict", 409);
            if (result is not JsonObject reply || IntegerNode(reply["revision"]) is not { } number || number < 0 || reply["document"] is not JsonObject doc || !ValidStudyDocument(doc)) return Error("invalid-study-response", 502);
            return Results.Json(result);
        }
        catch (JsonException) { return Error("invalid-study-response", 502); }
        catch (IOException) { return Error("study-storage-unavailable", 502); }
    }
    private static bool ValidStudyDocument(JsonObject document)
    {
        if (document["settings"] is not JsonObject settings || !ValidStudySettings(settings)) return false;
        if (document["importedSchedules"] is not null && !ValidImportedSchedules(document["importedSchedules"])) return false;
        foreach (var field in new[] { "adjustments", "corrections", "undoStates" })
        {
            if (document[field] is not JsonArray entries || entries.Count > 20000) return false;
            var ids = new HashSet<string>();
            foreach (var raw in entries)
            {
                if (raw is not JsonObject item) return false;
                var key = StringNode(item[field == "undoStates" ? "eventId" : "id"]);
                if (string.IsNullOrEmpty(key) || !ids.Add(key)) return false;
                if (field == "undoStates" && (!ValidStudySchedule(item["schedule"]) || !TryUuid(item["eventId"], out _))) return false;
                if (field == "corrections" && (!TryUuid(item["eventId"], out _) || !ValidStudyTimestamp(item["recordedAt"]))) return false;
                if (field == "adjustments" && (!TryUuid(item["areaId"], out _) || !TryUuid(item["cardId"], out _) || item["afterReviewEventId"] is not null && !TryUuid(item["afterReviewEventId"], out _) || StringNode(item["kind"]) is not ("due" or "reset") || !ValidStudyTimestamp(item["recordedAt"]) || !ValidStudyTimestamp(item["due"]))) return false;
            }
        }
        return true;
    }
    private static bool ValidStudyTimestamp(JsonNode? node) => StringNode(node) is { } text && text.EndsWith('Z') && DateTimeOffset.TryParse(text, out _);
    private static bool ValidStudySchedule(JsonNode? node)
    {
        if (node is not JsonObject schedule || !ValidStudyTimestamp(schedule["due"])) return false;
        foreach (var key in new[] { "stability", "difficulty", "elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses", "state" })
            if (schedule[key] is not JsonValue value || !value.TryGetValue<double>(out var number) || !double.IsFinite(number) || number < 0) return false;
        return IntegerNode(schedule["state"]) is >= 0 and <= 3 && (schedule["last_review"] is null || ValidStudyTimestamp(schedule["last_review"]));
    }
    private static bool ValidStudySettings(JsonObject settings)
    {
        if (settings["requestRetention"] is not JsonValue retention || !retention.TryGetValue<double>(out var r) || r < .7 || r > .97) return false;
        foreach (var (key, max) in new[] { ("presets", 100), ("savedSearches", 100), ("filteredDecks", 100), ("suspendedCardIds", 200000), ("browserColumns", 8) })
            if (settings[key] is not null && (settings[key] is not JsonArray array || array.Count > max)) return false;
        foreach (var (key, min, max) in new[] { ("dailyNewLimit", 0, 1000), ("dailyReviewLimit", 0, 10000), ("leechThreshold", 2, 100), ("maximumInterval", 1, 36500) })
            if (settings[key] is not null && (IntegerNode(settings[key]) is not { } n || n < min || n > max)) return false;
        foreach (var key in new[] { "learningSteps", "relearningSteps", "easyDays", "weights" })
        {
            if (settings[key] is null) continue;
            if (settings[key] is not JsonArray values || values.Count > (key == "weights" ? 21 : key == "easyDays" ? 7 : 5) || key == "weights" && values.Count != 21) return false;
            foreach (var value in values)
                if (value is not JsonValue number || !number.TryGetValue<double>(out var n) || !double.IsFinite(n) || n < (key is "learningSteps" or "relearningSteps" ? 1 : 0) || n > (key == "weights" ? 46.655 : key == "easyDays" ? 6 : 1440)) return false;
        }
        if (!ValidStudySettingDetails(settings)) return false;
        if (settings["presets"] is JsonArray presets && presets.Any(raw => raw is not JsonObject p || StringNode(p["id"]) is not { Length: > 0 and <= 80 } || StringNode(p["name"]) is not { Length: > 0 and <= 80 } || p["settings"] is not JsonObject policy || !ValidStudySettings(policy))) return false;
        return true;
    }
}
