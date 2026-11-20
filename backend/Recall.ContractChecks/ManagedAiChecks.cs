using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Recall.Api.Features.Tutor;

internal static class ManagedAiChecks
{
    public static async Task<IReadOnlyList<string>> Run()
    {
        var failures = new List<string>();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ANTHROPIC_API_KEY"] = "fixture-key", ["OPENAI_API_KEY"] = "fixture-key"
        }).Build();
        using var schema = JsonDocument.Parse("""{"type":"object","properties":{"question":{"type":"string"}},"required":["question"],"additionalProperties":false}""");
        var request = new TutorProviderRequest("question", "fixture-model", 1200, "Study tutor.", "Untrusted study material", schema.RootElement.Clone());
        foreach (var providerId in new[] { "openai", "anthropic" })
        foreach (var outcome in new[] { "valid", "refusal", "truncated", "missing-usage", "rate-limit" })
        {
            using var handler = new ProviderHandler(providerId, outcome);
            using var client = new HttpClient(handler);
            ITutorProvider adapter = providerId == "anthropic" ? new AnthropicTutorProvider(client, config) : new OpenAiTutorProvider(client, config);
            var result = await adapter.GenerateAsync(request);
            var expectedSuccess = outcome is "valid" or "missing-usage";
            if ((result is Result<TutorProviderReply, TutorProviderFailure>.Success) != expectedSuccess)
                failures.Add($"{providerId} {outcome}: unexpected provider result");
            if (result is Result<TutorProviderReply, TutorProviderFailure>.Success success &&
                (success.Value.Usage.Model != "fixture-model" || (outcome == "missing-usage" && success.Value.Usage.InputTokens is not null)))
                failures.Add($"{providerId} {outcome}: incorrect usage identity/completeness");
            if (!handler.ValidRequest) failures.Add($"{providerId}: invalid structured protocol request");
        }
        return failures;
    }
    private sealed class ProviderHandler(string provider, string outcome) : HttpMessageHandler
    {
        public bool ValidRequest { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            var root = body.RootElement;
            ValidRequest = provider == "anthropic"
                ? request.RequestUri?.Host == "api.anthropic.com" && root.GetProperty("max_tokens").GetInt32() == 1200 && root.TryGetProperty("output_config", out _)
                : request.RequestUri?.Host == "api.openai.com" && root.GetProperty("max_output_tokens").GetInt32() == 1200 && !root.GetProperty("store").GetBoolean();
            var text = "{\"question\":\"Why?\"}";
            object payload = provider == "anthropic"
                ? new { stop_reason = outcome == "refusal" ? "refusal" : outcome == "truncated" ? "max_tokens" : "end_turn", content = new[] { new { type = "text", text } }, usage = outcome == "missing-usage" ? null : new { input_tokens = 10, output_tokens = 5 } }
                : new { status = outcome == "truncated" ? "incomplete" : "completed", output = new[] { new { content = new[] { new { type = outcome == "refusal" ? "refusal" : "output_text", text } } } }, usage = outcome == "missing-usage" ? null : new { input_tokens = 10, output_tokens = 5 } };
            return new HttpResponseMessage(outcome == "rate-limit" ? HttpStatusCode.TooManyRequests : HttpStatusCode.OK)
            { Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json") };
        }
    }
}
