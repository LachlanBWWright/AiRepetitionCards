using System.Text.Json.Nodes;
namespace Recall.Api.Features.Sync;
internal static partial class SyncHandlers
{
    private static bool ValidStudyLimits(JsonObject settings)
    {
        if (settings["areaReviewLimits"] is not null)
        {
            if (settings["areaReviewLimits"] is not JsonObject limits || limits.Count > 20000) return false;
            foreach (var (id, value) in limits)
                if (string.IsNullOrWhiteSpace(id) || IntegerNode(value) is not (>= 0 and <= 10000)) return false;
        }
        if (settings["dailyLimitOverrides"] is null) return true;
        if (settings["dailyLimitOverrides"] is not JsonArray overrides || overrides.Count > 100) return false;
        foreach (var raw in overrides)
        {
            if (raw is not JsonObject item || IntegerNode(item["startsAt"]) is not { } start || IntegerNode(item["endsAt"]) is not { } end || end <= start || end - start > 172800000) return false;
            if (item["areaId"] is not null && !StudyString(item["areaId"], 1, int.MaxValue)) return false;
            if (item["dailyNewLimit"] is not null && IntegerNode(item["dailyNewLimit"]) is not (>= 0 and <= 1000)) return false;
            if (item["dailyReviewLimit"] is not null && IntegerNode(item["dailyReviewLimit"]) is not (>= 0 and <= 10000)) return false;
            if (item["dailyReviewLimit"] is null && item["dailyNewLimit"] is null) return false;
        }
        return true;
    }
}
