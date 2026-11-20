using System.Text.Json;
using System.Text.Json.Nodes;

namespace Recall.Api.Features.Tutor;

internal static class AnthropicOutputSchema
{
    private static readonly HashSet<string> Constraints = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "pattern", "format"];
    public static JsonNode? Prepare(JsonElement schema) => Transform(JsonNode.Parse(schema.GetRawText()));
    private static JsonNode? Transform(JsonNode? node)
    {
        if (node is JsonArray array) return new JsonArray(array.Select(Transform).ToArray());
        if (node is not JsonObject obj) return node?.DeepClone();
        var result = new JsonObject();
        var constraints = new JsonObject();
        foreach (var property in obj)
        {
            if (Constraints.Contains(property.Key)) { constraints[property.Key] = property.Value?.DeepClone(); continue; }
            if (property.Key is "properties" or "$defs" or "definitions" && property.Value is JsonObject properties)
            {
                var children = new JsonObject();
                foreach (var child in properties) children[child.Key] = Transform(child.Value);
                result[property.Key] = children;
            }
            else result[property.Key] = Transform(property.Value);
        }
        if (constraints.Count > 0) result["description"] = $"{result["description"]?.GetValue<string>()} Constraints: {constraints.ToJsonString()}".Trim();
        var type = result["type"];
        if (type is JsonValue value && value.TryGetValue<string>(out var text) && text == "object" ||
            type is JsonArray types && types.Any(item => item?.ToJsonString() == "\"object\"")) result["additionalProperties"] = false;
        return result;
    }
}
