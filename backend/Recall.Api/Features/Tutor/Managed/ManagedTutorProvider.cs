using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed class ManagedTutorProvider(
    OpenAiTutorProvider openAi, AnthropicTutorProvider anthropic,
    ManagedAiStore store, IHttpContextAccessor http, IConfiguration configuration) : ITutorProvider
{
    public async Task<Result<TutorProviderReply, TutorProviderFailure>> GenerateAsync(TutorProviderRequest request, CancellationToken cancellationToken = default)
    {
        var context = http.HttpContext;
        var selected = context?.Request.Headers["x-recall-ai-funding"].ToString() == "managed";
        if (!store.Enabled && !selected) return await openAi.GenerateAsync(request, cancellationToken);
        if (!store.Enabled || !selected || context is null) return Fail(TutorProviderFailureKind.ManagedNotEntitled);
        var resolved = await SupabaseApiRequestContext.ResolveAsync(context, configuration);
        if (resolved is not SupabaseApiRequestResult.Authenticated auth) return Fail(TutorProviderFailureKind.ManagedNotEntitled);
        var owner = auth.Context.UserId;
        var plan = await store.RpcAsync("managed_ai_plan", new { p_user_id = owner, p_operation = request.Operation }, cancellationToken);
        if (!ManagedAiStore.Allowed(plan)) return Fail(ManagedAiStore.Denial(plan));
        var value = plan!.Value;
        if (!TryString(value, "model", out var model) || !TryString(value, "providerId", out var providerId) ||
            !TryString(value, "deploymentId", out var deploymentId) || !TryString(value, "pricingVersion", out var pricingVersion) ||
            !value.TryGetProperty("maxInputBytes", out var maxInput) || !maxInput.TryGetInt32(out var maxInputBytes) ||
            !value.TryGetProperty("maxOutputTokens", out var maxOutput) || !maxOutput.TryGetInt32(out var maxOutputTokens)) return Fail(TutorProviderFailureKind.SharedBudgetUnavailable);
        ITutorProvider? adapter = providerId switch { "openai" => openAi, "anthropic" => anthropic, _ => null };
        var key = configuration[providerId == "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"];
        if (adapter is null || string.IsNullOrWhiteSpace(key)) return Fail(TutorProviderFailureKind.NotConfigured);
        var resolvedRequest = request with { Model = model };
        var bytes = TutorProviderPayload.Bytes(providerId, resolvedRequest);
        if (bytes > maxInputBytes || request.MaximumOutputTokens > maxOutputTokens) return Fail(TutorProviderFailureKind.ContextTooLarge);
        var rawId = context.Request.Headers["x-recall-ai-request-id"].ToString();
        var callId = string.IsNullOrEmpty(rawId) ? Guid.NewGuid() : Guid.TryParseExact(rawId, "D", out var parsed) ? parsed : Guid.Empty;
        if (callId == Guid.Empty) return Fail(TutorProviderFailureKind.SharedBudgetUnavailable);
        var admission = await store.RpcAsync("managed_ai_reserve", new
        {
            p_user_id = owner, p_call_id = callId, p_operation = request.Operation, p_deployment_id = deploymentId,
            p_pricing_version = pricingVersion, p_model = model, p_input_bytes = bytes, p_output_tokens = request.MaximumOutputTokens
        }, cancellationToken);
        if (!ManagedAiStore.Allowed(admission)) return Fail(ManagedAiStore.Denial(admission));
        var result = await adapter.GenerateAsync(resolvedRequest, cancellationToken);
        var usage = result switch
        {
            Result<TutorProviderReply, TutorProviderFailure>.Success success => success.Value.Usage,
            Result<TutorProviderReply, TutorProviderFailure>.Failure failure => failure.Error.Usage, _ => null
        };
        // Settlement must survive caller cancellation. Unknown outcomes retain their entire hold.
        var settled = await store.RpcAsync("managed_ai_settle", new
        {
            p_user_id = owner, p_call_id = callId, p_input_tokens = usage?.InputTokens, p_output_tokens = usage?.OutputTokens, p_returned_model = usage?.Model
        }, CancellationToken.None);
        return settled is { ValueKind: JsonValueKind.True } ? result : Fail(TutorProviderFailureKind.SharedBudgetUnavailable);
    }
    private static bool TryString(JsonElement value, string property, out string text)
    {
        text = "";
        return value.ValueKind == JsonValueKind.Object && value.TryGetProperty(property, out var raw) &&
            raw.ValueKind == JsonValueKind.String && (text = raw.GetString() ?? "").Length > 0;
    }
    private static Result<TutorProviderReply, TutorProviderFailure> Fail(TutorProviderFailureKind kind) =>
        new Result<TutorProviderReply, TutorProviderFailure>.Failure(new(kind));
}
