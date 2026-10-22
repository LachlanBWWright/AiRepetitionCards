using System.Text.Json.Nodes;
namespace Recall.Api.Features.Sync;
internal static partial class SyncHandlers
{
    private static bool ValidImportedSchedules(JsonNode? value)
    {
        if (value is not JsonArray entries || entries.Count > 20000) return false;
        var ids = new HashSet<string>();
        foreach (var raw in entries)
        {
            if (raw is not JsonObject entry || !TryUuid(entry["areaId"], out _) || !TryUuid(entry["cardId"], out var cardId) || !ids.Add(cardId) || entry["baseline"] is not JsonObject baseline || !ValidStudySchedule(baseline["schedule"]) || baseline["reviewEventIds"] is not JsonArray reviews || reviews.Count > 100000) return false;
            var events = new HashSet<string>();
            foreach (var id in reviews) if (!TryUuid(id, out var eventId) || !events.Add(eventId)) return false;
        }
        return true;
    }
}
