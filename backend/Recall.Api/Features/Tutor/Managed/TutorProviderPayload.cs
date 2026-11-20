using System.Text.Json;

namespace Recall.Api.Features.Tutor;

/// <summary>The exact wire payload is shared by admission and dispatch; no envelope estimates.</summary>
internal static class TutorProviderPayload
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    private static object Body(string provider, TutorProviderRequest request)
    {
        var instructions = TutorProviderPrompt.Compose(request.Instructions);
        if (provider == "anthropic") return new
        {
            model = request.Model, max_tokens = request.MaximumOutputTokens, system = instructions,
            messages = new[] { new { role = "user", content = request.Input } },
            output_config = new { format = new { type = "json_schema", schema = AnthropicOutputSchema.Prepare(request.OutputSchema) } }
        };
        return new
        {
            model = request.Model, store = false, max_output_tokens = request.MaximumOutputTokens,
            instructions, input = request.Input,
            text = new { format = new { type = "json_schema", name = request.Operation.Replace("-", "_", StringComparison.Ordinal), strict = true, schema = request.OutputSchema } }
        };
    }
    public static int Bytes(string provider, TutorProviderRequest request) => JsonSerializer.SerializeToUtf8Bytes(Body(provider, request), Options).Length;
    public static JsonContent Content(string provider, TutorProviderRequest request) => JsonContent.Create(Body(provider, request), options: Options);
}
