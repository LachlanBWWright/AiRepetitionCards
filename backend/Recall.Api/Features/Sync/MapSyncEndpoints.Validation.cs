using System.Globalization;
using System.Text.Json.Nodes;

namespace Recall.Api.Features.Sync;

internal static partial class SyncHandlers
{
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
}
