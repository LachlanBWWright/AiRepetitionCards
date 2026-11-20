using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

/// <summary>Anthropic Messages structured-output protocol, with no tools or automatic retries.</summary>
public sealed class AnthropicTutorProvider(HttpClient client, IConfiguration configuration) : ITutorProvider
{
    public async Task<Result<TutorProviderReply, TutorProviderFailure>> GenerateAsync(TutorProviderRequest request, CancellationToken cancellationToken = default)
    {
        var key = configuration["ANTHROPIC_API_KEY"]?.Trim();
        if (string.IsNullOrEmpty(key) || request.MaximumOutputTokens is < 1 or > 2600) return Fail(TutorProviderFailureKind.NotConfigured);
        var instructions = TutorProviderPrompt.Compose(request.Instructions);
        if (Encoding.UTF8.GetByteCount(instructions) + Encoding.UTF8.GetByteCount(request.Input) > 96000)
            return Fail(TutorProviderFailureKind.ContextTooLarge);
        using var message = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        message.Headers.TryAddWithoutValidation("x-api-key", key);
        message.Headers.TryAddWithoutValidation("anthropic-version", "2023-06-01");
        message.Content = TutorProviderPayload.Content("anthropic", request);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        try
        {
            using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            while (true)
            {
                var count = await stream.ReadAsync(chunk, timeout.Token);
                if (count == 0) break;
                if (buffer.Length + count > 1_000_000) return Fail(TutorProviderFailureKind.InvalidStructuredOutput);
                await buffer.WriteAsync(chunk.AsMemory(0, count), timeout.Token);
            }
            using var document = JsonDocument.Parse(buffer.ToArray());
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return Fail(TutorProviderFailureKind.InvalidStructuredOutput);
            var usage = ReadUsage(root, request.Model);
            if (!response.IsSuccessStatusCode) return Fail(response.StatusCode == System.Net.HttpStatusCode.TooManyRequests
                ? TutorProviderFailureKind.RateLimited : TutorProviderFailureKind.Unavailable, usage);
            if (!root.TryGetProperty("stop_reason", out var stop) || stop.ValueKind != JsonValueKind.String) return Fail(TutorProviderFailureKind.InvalidStructuredOutput, usage);
            if (stop.GetString() == "refusal") return Fail(TutorProviderFailureKind.Refused, usage);
            if (stop.GetString() != "end_turn" || !root.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
                return Fail(TutorProviderFailureKind.InvalidStructuredOutput, usage);
            var text = string.Concat(content.EnumerateArray().Where(part => part.ValueKind == JsonValueKind.Object &&
                part.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String && type.GetString() == "text" && part.TryGetProperty("text", out var textPart) && textPart.ValueKind == JsonValueKind.String)
                .Select(part => part.GetProperty("text").GetString()));
            try
            {
                using var output = JsonDocument.Parse(text);
                return new Result<TutorProviderReply, TutorProviderFailure>.Success(new(output.RootElement.Clone(), usage));
            }
            catch (JsonException) { return Fail(TutorProviderFailureKind.InvalidStructuredOutput, usage); }
        }
        catch (HttpRequestException) { return Fail(TutorProviderFailureKind.Unavailable); }
        catch (OperationCanceledException) { return Fail(TutorProviderFailureKind.Unavailable); }
        catch (IOException) { return Fail(TutorProviderFailureKind.Unavailable); }
        catch (JsonException) { return Fail(TutorProviderFailureKind.InvalidStructuredOutput); }
    }

    private static TutorProviderUsage ReadUsage(JsonElement root, string model)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("usage", out var usage)) return new(null, null, model);
        if (root.TryGetProperty("model", out var identity) && identity.ValueKind == JsonValueKind.String && identity.GetString() is { Length: > 0 and <= 200 } returnedModel) model = returnedModel;
        var input = Count(usage, "input_tokens");
        var cached = (long)(Count(usage, "cache_creation_input_tokens") ?? 0) + (Count(usage, "cache_read_input_tokens") ?? 0);
        return new(input is not null && input + cached <= int.MaxValue ? (int)(input + cached) : null, Count(usage, "output_tokens"), model);
    }
    private static int? Count(JsonElement value, string name) => value.ValueKind == JsonValueKind.Object &&
        value.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var count) && count >= 0 ? count : null;
    private static Result<TutorProviderReply, TutorProviderFailure> Fail(TutorProviderFailureKind kind, TutorProviderUsage? usage = null) =>
        new Result<TutorProviderReply, TutorProviderFailure>.Failure(new(kind, usage));
}
