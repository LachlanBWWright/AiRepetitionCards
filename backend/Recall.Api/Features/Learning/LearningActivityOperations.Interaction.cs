using System.Text.Json;

namespace Recall.Api.Features.Learning;

public sealed partial class LearningActivityOperations
{
    private static bool ValidOptionalInteraction(JsonElement response)
    {
        if (!response.TryGetProperty("interaction", out var interaction)) return true;
        if (interaction.ValueKind != JsonValueKind.Object || interaction.GetRawText().Length > 100_000) return false;
        if (!OptionalSafeInteger(interaction, "seed", 9_007_199_254_740_991) ||
            !OptionalSafeInteger(interaction, "hints", 10_000) || !OptionalSafeInteger(interaction, "retries", 10_000)) return false;
        if (interaction.TryGetProperty("firstTry", out var first) && first.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        if (!interaction.TryGetProperty("actions", out var actions)) return true;
        return actions.ValueKind == JsonValueKind.Array && actions.GetArrayLength() <= 200 && actions.EnumerateArray().All(action =>
            action.ValueKind == JsonValueKind.Object && String(action, "type", 200, 1) &&
            (!action.TryGetProperty("targetId", out _) || String(action, "targetId", 200, 1)) &&
            (!action.TryGetProperty("value", out var value) || BoundedJson(value)));
    }

    private static bool ValidOptionalRuntime(JsonElement attempt)
    {
        if (!attempt.TryGetProperty("runtime", out var runtime)) return true;
        return runtime.ValueKind == JsonValueKind.Object && String(runtime, "runtime", 200, 1) && String(runtime, "runtimeVersion", 200, 1) &&
            (!runtime.TryGetProperty("scriptVersion", out _) || String(runtime, "scriptVersion", 200, 1)) && OptionalSafeInteger(runtime, "seed", 9_007_199_254_740_991);
    }

    private static bool OptionalSafeInteger(JsonElement value, string key, long maximum) => !value.TryGetProperty(key, out var field) ||
        field.ValueKind == JsonValueKind.Number && field.TryGetInt64(out var number) && number >= 0 && number <= maximum;
}
