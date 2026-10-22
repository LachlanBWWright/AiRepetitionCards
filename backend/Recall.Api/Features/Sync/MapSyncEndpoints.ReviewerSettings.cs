using System.Text.Json.Nodes;
namespace Recall.Api.Features.Sync;
internal static partial class SyncHandlers
{
    private static bool ValidReviewerSettings(JsonNode? node)
    {
        if (node is not JsonObject reviewer) return false;
        foreach (var key in new[] { "showTimer", "swipeEnabled" })
            if (reviewer[key] is not JsonValue flag || !flag.TryGetValue<bool>(out _)) return false;
        foreach (var key in new[] { "questionSeconds", "answerSeconds" })
            if (IntegerNode(reviewer[key]) is not (>= 0 and <= 600)) return false;
        if (StringNode(reviewer["answerAction"]) is not ("again" or "hard" or "good" or "easy")) return false;
        foreach (var key in new[] { "swipeLeft", "swipeRight" })
            if (StringNode(reviewer[key]) is not ("reveal" or "again" or "hard" or "good" or "easy")) return false;
        if (reviewer["shortcuts"] is not JsonObject shortcuts) return false;
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var action in new[] { "reveal", "again", "hard", "good", "easy" })
        {
            var key = StringNode(shortcuts[action]);
            if (key is not { Length: 1 } || !(key[0] == ' ' || char.IsAsciiLetterOrDigit(key[0])) || !keys.Add(key)) return false;
        }
        return true;
    }
}
