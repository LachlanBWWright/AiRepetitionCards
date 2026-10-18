using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private static bool TryNullableString(JsonElement row, string name, out string? value)
    {
        value = null;
        if (!row.TryGetProperty(name, out var element)) return false;
        if (element.ValueKind == JsonValueKind.Null) return true;
        if (element.ValueKind != JsonValueKind.String || (value = element.GetString()) is not { Length: > 0 }) return false;
        return true;
    }

    private static bool TryNullablePositiveInt(JsonElement row, string name, out int? value)
    {
        value = null;
        if (!row.TryGetProperty(name, out var element)) return false;
        if (element.ValueKind == JsonValueKind.Null) return true;
        if (!element.TryGetInt32(out var number) || number <= 0) return false;
        value = number;
        return true;
    }

    private static JsonElement CreateQuizSchema() => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new Dictionary<string, object>
        {
            ["objectiveId"] = new { type = "string", minLength = 1, maxLength = 200 },
            ["objectiveTitle"] = new { type = "string", minLength = 1, maxLength = 500 },
            ["questions"] = new
            {
                type = "array",
                minItems = 2,
                maxItems = 5,
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new { prompt = new { type = "string", minLength = 1, maxLength = 1_000 }, expectedAnswer = new { type = "string", minLength = 1, maxLength = 2_000 } },
                    required = new[] { "prompt", "expectedAnswer" }
                }
            }
        },
        required = new[] { "objectiveId", "objectiveTitle", "questions" }
    }, JsonOptions);

    private static bool TryValidateQuiz(JsonElement output, string objectiveId, string objectiveTitle, out QuizResult result)
    {
        result = default!;
        if (output.ValueKind != JsonValueKind.Object || !TryString(output, "objectiveId", out var outId) || outId != objectiveId ||
            !TryString(output, "objectiveTitle", out var outTitle) || outTitle != objectiveTitle ||
            !output.TryGetProperty("questions", out var questions) || questions.ValueKind != JsonValueKind.Array || questions.GetArrayLength() is < 2 or > 5)
            return false;
        var parsed = new List<QuizQuestion>();
        foreach (var question in questions.EnumerateArray())
        {
            if (!TryString(question, "prompt", out var prompt) || prompt.Length > 1_000 ||
                !TryString(question, "expectedAnswer", out var expected) || expected.Length > 2_000) return false;
            parsed.Add(new QuizQuestion(prompt, expected));
        }
        result = new QuizResult(objectiveId, objectiveTitle, parsed);
        return true;
    }

    private static IReadOnlyList<TutorObjective>? ReadObjectives(JsonElement area)
    {
        if (!area.TryGetProperty("objectives", out var objectives) || objectives.ValueKind != JsonValueKind.Array) return null;
        var result = new List<TutorObjective>();
        foreach (var objective in objectives.EnumerateArray())
            if (!TryString(objective, "id", out var id) || !TryString(objective, "title", out var title)) return null;
            else result.Add(new TutorObjective(id, title));
        return result;
    }
}
