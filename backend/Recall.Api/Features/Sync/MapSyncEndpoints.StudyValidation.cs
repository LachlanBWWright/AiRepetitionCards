using System.Text.Json.Nodes;
namespace Recall.Api.Features.Sync;
internal static partial class SyncHandlers
{
    private static bool StudyString(JsonNode? value, int min, int max) => StringNode(value) is { } text && text.Length >= min && text.Length <= max;
    private static bool StudyEnum(JsonObject value, string key, params string[] choices) => value[key] is null || choices.Contains(StringNode(value[key]), StringComparer.Ordinal);
    private static bool ValidStudySettingDetails(JsonObject settings)
    {
        if (!StudyEnum(settings, "reviewOrder", "due", "retrievability", "interval-ascending", "interval-descending") || !StudyEnum(settings, "newReviewOrder", "after", "before", "mix")) return false;
        foreach (var key in new[] { "pauseNewWhenOverdue", "burySiblings", "buryNewSiblings", "buryReviewSiblings", "buryLearningSiblings", "rescheduleOnParameterChange" })
            if (settings[key] is not null && (settings[key] is not JsonValue value || !value.TryGetValue<bool>(out _))) return false;
        if (settings["activeStudyQuery"] is not null && !StudyString(settings["activeStudyQuery"], 0, 500) || settings["timeZone"] is not null && !StudyString(settings["timeZone"], 1, 80)) return false;
        foreach (var key in new[] { "learningSteps", "relearningSteps", "easyDays" })
            if (settings[key] is JsonArray numbers && numbers.Any(value => IntegerNode(value) is null)) return false;
        foreach (var key in new[] { "areaParents", "areaPresets", "newCardPositions" })
        {
            if (settings[key] is null) continue;
            if (settings[key] is not JsonObject map) return false;
            foreach (var (_, value) in map)
                if (key == "newCardPositions" ? IntegerNode(value) is not (>= 0 and <= 1000000) : StringNode(value) is null) return false;
        }
        if (settings["suspendedCardIds"] is JsonArray suspended && suspended.Any(value => !StudyString(value, 1, int.MaxValue))) return false;
        if (settings["browserColumns"] is JsonArray columns && (columns.Count < 1 || columns.Any(value => StringNode(value) is not ("subject" or "front" or "back" or "due" or "interval" or "lapses" or "tags" or "state")))) return false;
        foreach (var key in new[] { "savedSearches", "filteredDecks", "presets" })
        {
            if (settings[key] is not JsonArray entries) continue;
            var ids = new HashSet<string>();
            foreach (var entry in entries)
            {
                if (entry is not JsonObject item || !StudyString(item["id"], 1, 80) || !ids.Add(StringNode(item["id"])!) || !StudyString(item["name"], 1, 80)) return false;
                if (key == "presets") continue;
                if (!StudyString(item["query"], key == "savedSearches" ? 1 : 0, 500)) return false;
                if (key == "filteredDecks" && (IntegerNode(item["limit"]) is not (>= 1 and <= 500) || StringNode(item["order"]) is not ("due" or "weakest" or "shortest" or "longest") || StringNode(item["mode"]) is not ("preview" or "reschedule") || item["areaId"] is not null && !StudyString(item["areaId"], 1, int.MaxValue))) return false;
            }
        }
        if (settings["optimizationReviewedAfter"] is not null && !ValidStudyTimestamp(settings["optimizationReviewedAfter"])) return false;
        if (settings["reviewer"] is not null && !ValidReviewerSettings(settings["reviewer"])) return false;
        return ValidStudyLimits(settings);
    }
}
