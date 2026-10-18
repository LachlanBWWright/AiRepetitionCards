using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private static IReadOnlyList<TutorHistoryEntry> SelectTutorContextHistory(IReadOnlyList<TutorHistoryEntry> history)
    {
        var recent = history.TakeLast(40).ToArray();
        var bytes = 2;
        var start = recent.Length;
        for (var index = recent.Length - 1; index >= 0; index--)
        {
            var item = recent[index];
            var itemBytes = JsonSerializer.SerializeToUtf8Bytes(new { role = item.Role, content = item.Content }, JsonOptions).Length + 1;
            if (bytes + itemBytes > 48 * 1024) break;
            bytes += itemBytes;
            start = index;
        }
        return recent[start..];
    }

    private static string CreateInferenceInput(
        JsonElement area,
        IReadOnlyList<TutorHistoryEntry> history,
        JsonElement? investigation,
        string? extraName = null,
        object? extraValue = null,
        string? priorityObjectiveId = null)
    {
        var recent = SelectTutorContextHistory(history).ToArray();
        string Serialize(JsonNode areaNode, IReadOnlyList<TutorHistoryEntry> messages)
        {
            var root = new JsonObject
            {
                ["knowledgeArea"] = areaNode.DeepClone(),
                ["history"] = new JsonArray(messages.Select(message => (JsonNode?)new JsonObject
                {
                    ["role"] = message.Role,
                    ["content"] = message.Content
                }).ToArray())
            };
            if (investigation is JsonElement investigationValue) root["investigation"] = JsonNode.Parse(investigationValue.GetRawText());
            if (extraName is not null) root[extraName] = JsonSerializer.SerializeToNode(extraValue, JsonOptions);
            return root.ToJsonString(JsonOptions);
        }
        var fullArea = JsonNode.Parse(area.GetRawText()) as JsonObject ?? new JsonObject();
        var full = Serialize(fullArea, recent);
        if (Encoding.UTF8.GetByteCount(full) <= 80_000) return full;
        var reducedArea = (JsonObject)fullArea.DeepClone();
        reducedArea["description"] = null;
        reducedArea["tags"] = new JsonArray();
        reducedArea["cards"] = new JsonArray();
        var selectedHistory = recent.TakeLast(2).ToList();
        var selected = Serialize(reducedArea, selectedHistory);
        if (Encoding.UTF8.GetByteCount(selected) > 80_000) return selected;
        var objective = priorityObjectiveId ?? (extraValue is JsonElement extraJson && TryString(extraJson, "objectiveId", out var extraObjective) ? extraObjective : null);
        var cards = fullArea["cards"] as JsonArray;
        var orderedCards = cards?.Select(node => node?.DeepClone()).Where(node => node is JsonObject)
            .Cast<JsonObject>().OrderByDescending(card => objective is not null && card["objectiveIds"] is JsonArray ids &&
                ids.Any(id => id?.GetValueKind() == JsonValueKind.String && id.GetValue<string>() == objective))
            .ThenBy(card => card["id"]?.GetValue<string>() ?? string.Empty, StringComparer.Ordinal).ToArray() ?? [];
        var cardBudget = Math.Max(Encoding.UTF8.GetByteCount(selected), 80_000 - 16_000);
        foreach (var card in orderedCards)
        {
            var areaCards = reducedArea["cards"] as JsonArray;
            areaCards?.Add(card.DeepClone());
            var candidate = Serialize(reducedArea, selectedHistory);
            if (Encoding.UTF8.GetByteCount(candidate) <= cardBudget) selected = candidate;
            else if (areaCards is { Count: > 0 }) areaCards.RemoveAt(areaCards.Count - 1);
        }
        for (var index = recent.Length - 3; index >= 0; index--)
        {
            var candidateHistory = new List<TutorHistoryEntry> { recent[index] };
            candidateHistory.AddRange(selectedHistory);
            var candidate = Serialize(reducedArea, candidateHistory);
            if (Encoding.UTF8.GetByteCount(candidate) > 80_000) break;
            selectedHistory = candidateHistory;
            selected = candidate;
        }
        return selected;
    }

    private static bool TryValidateInvestigation(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object ||
            !TryString(value, "goal", out var goal) || goal.Length is < 1 or > 2_000 ||
            !TryString(value, "conceptTitle", out var title) || title.Length is < 1 or > 500 ||
            !TryString(value, "investigationKind", out var kind) || kind.Length is < 1 or > 100 ||
            !value.TryGetProperty("uncertainty", out var uncertainty) || !uncertainty.TryGetDouble(out var score) || score is < 0 or > 1 ||
            !TryString(value, "reason", out var reason) || reason.Length is < 1 or > 1_000 ||
            !value.TryGetProperty("objectiveId", out var objective) ||
            objective.ValueKind != JsonValueKind.Null && (objective.ValueKind != JsonValueKind.String || (objective.GetString()?.Length ?? 0) is < 1 or > 200))
            return false;
        if (value.TryGetProperty("conceptDescription", out var description) &&
            description.ValueKind != JsonValueKind.Null && (description.ValueKind != JsonValueKind.String || (description.GetString()?.Length ?? 0) > 2_000)) return false;
        if (value.TryGetProperty("uncertaintyBasis", out var basis) &&
            (basis.ValueKind != JsonValueKind.String || (basis.GetString()?.Length ?? 0) > 500)) return false;
        return true;
    }

    private static IReadOnlyList<TutorHistoryEntry>? ParseHistory(JsonElement historyJson)
    {
        var history = new List<TutorHistoryEntry>();
        foreach (var item in historyJson.EnumerateArray())
            if (item.ValueKind != JsonValueKind.Object || !TryString(item, "role", out var role) || role is not ("assistant" or "learner") ||
                !TryString(item, "content", out var content) || content.Length > 8_000) return null;
            else history.Add(new TutorHistoryEntry(role, content));
        return history;
    }

    private static JsonElement CreateRefinementSchema(string? objectiveId) => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new
        {
            cards = new
            {
                type = "array",
                minItems = 1,
                maxItems = 5,
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        front = new { type = "string", minLength = 1, maxLength = 1_000 },
                        back = new { type = "string", minLength = 1, maxLength = 3_000 },
                        objectiveId = new { @enum = new object?[] { objectiveId } },
                        rationale = new { type = "string", minLength = 1, maxLength = 1_000 },
                        meaningChanged = new { type = "boolean" },
                        sourceReferences = CreateSourceReferencesSchema()
                    },
                    required = new[] { "front", "back", "objectiveId", "rationale", "meaningChanged", "sourceReferences" }
                }
            }
        },
        required = new[] { "cards" }
    }, JsonOptions);

    private static object CreateSourceReferencesSchema() => new
    {
        type = "array",
        maxItems = 4,
        items = new
        {
            type = "object",
            additionalProperties = false,
            properties = new { materialId = new { type = "string" }, sectionId = new { type = "string" }, quote = new { type = "string", minLength = 1, maxLength = 2_000 }, pageNumber = new { type = new[] { "integer", "null" } } },
            required = new[] { "materialId", "sectionId", "quote", "pageNumber" }
        }
    };
}
