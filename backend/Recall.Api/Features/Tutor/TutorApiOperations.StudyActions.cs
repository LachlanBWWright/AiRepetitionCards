using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private async Task<IResult> ExecutePlanStudyAsync(
        HttpContext httpContext,
        SupabaseApiRequestContext context,
        JsonElement root,
        CancellationToken cancellationToken)
    {
        if (!TryPlanStudyRequest(root, out var input)) return Error("invalid-request", 400);
        var resolution = await ResolveActionContextAsync(context, input.SessionId, input.AreaId == Guid.Empty ? null : input.AreaId,
            input.Fingerprint, input.History, cancellationToken);
        if (ContextFailure(resolution) is IResult contextError) return contextError;
        var resolved = ((ActionContextResolution.Success)resolution).Context;
        var area = resolved.Area;
        var combined = CreateInferenceInput(area, resolved.History, input.Investigation, "material", input.Material);
        const string instructions = "You are a learning tutor inside Recall. Extract up to twenty focused, testable claims from the supplied source matching the goal and depth. Each claim needs exact verbatim supporting quotes with matching source identity and page. Set pedagogical priority high, medium or low. This is a proposed coverage outline for learner approval, not evidence of mastery or complete document coverage. Omit unsupported claims. Return only the requested structured result.";
        if (Encoding.UTF8.GetByteCount(combined) > 80_000) return Error("context-budget-exceeded", 413);
        var model = ConfiguredModel("OPENAI_PROPOSAL_MODEL");
        if (!ValidConfiguredModel(model)) return Error("ai-unavailable", 503);
        var callId = Guid.NewGuid();
        var reservation = await PostRpcAsync(context, "reserve_tutor_ai_call", JsonSerializer.SerializeToElement(new
        {
            p_id = callId,
            p_operation = "propose-card",
            p_model = model
        }, JsonOptions), cancellationToken);
        if (reservation is null) return Error("tutor-storage-unavailable", 502);
        if (reservation.Value.ValueKind != JsonValueKind.True) return Error("You've reached today's tutor limit. Try again tomorrow.", 429);
        var generated = await GenerateWithBudgetAsync(context, callId, new TutorProviderRequest(
            "plan-study", model!, 2_600, instructions, combined, CreatePlanStudySchema()), cancellationToken);
        if (generated is Result<TutorProviderReply, TutorProviderFailure>.Failure aiFailure) return ProviderError(aiFailure.Error);
        var reply = ((Result<TutorProviderReply, TutorProviderFailure>.Success)generated).Value;
        if (!TryValidatePlanStudy(reply.Output, input.Source, out var result)) return Error("invalid-provider-response", 502);
        var sessionId = resolved.SessionId ?? Guid.NewGuid();
        if (resolved.SessionId is null && !await InsertRowsAsync(context, "tutor_sessions", new
        {
            id = sessionId,
            user_id = context.UserId,
            area_id = resolved.AreaId.ToString("D"),
            area_title = ReadTitle(area),
            area_snapshot = area
        }, cancellationToken)) return Error("tutor-storage-unavailable", 502);
        httpContext.Response.Headers.CacheControl = "private, no-store, max-age=0";
        return Results.Json(new { schemaVersion = 1, response = new { action = "plan-study", sessionId, result } });
    }

    private async Task<IResult> ExecuteInspectCardAsync(
        HttpContext httpContext,
        SupabaseApiRequestContext context,
        JsonElement root,
        CancellationToken cancellationToken)
    {
        if (!TryInspectRequest(root, out var input)) return Error("invalid-request", 400);
        var resolution = await ResolveActionContextAsync(context, input.SessionId, input.AreaId == Guid.Empty ? null : input.AreaId,
            input.Fingerprint, input.History, cancellationToken);
        if (ContextFailure(resolution) is IResult contextError) return contextError;
        var resolved = ((ActionContextResolution.Success)resolution).Context;
        var area = resolved.Area;
        var objectives = ReadObjectiveIds(area);
        if (objectives is null || input.ObjectiveId is not null && !objectives.Contains(input.ObjectiveId)) return Error("unknown-objective", 400);
        var combined = CreateInferenceInput(area, resolved.History, input.Investigation, "inspection", input.Inspection);
        const string instructions = "You are a learning tutor inside Recall. Inspect the supplied card for ambiguity, multiple independently testable facts, answer leakage, missing context, and unsupported claims. Return concrete explanations and fixes, no numeric quality score. Distinguish confirmed issues from suggestions. Without source material, state that support cannot be verified. Return only the requested structured result.";
        if (Encoding.UTF8.GetByteCount(combined) > 80_000) return Error("context-budget-exceeded", 413);
        var model = ConfiguredModel("OPENAI_EVALUATION_MODEL");
        if (!ValidConfiguredModel(model)) return Error("ai-unavailable", 503);
        var callId = Guid.NewGuid();
        var reservation = await PostRpcAsync(context, "reserve_tutor_ai_call", JsonSerializer.SerializeToElement(new
        {
            p_id = callId,
            p_operation = "evaluate",
            p_model = model
        }, JsonOptions), cancellationToken);
        if (reservation is null) return Error("tutor-storage-unavailable", 502);
        if (reservation.Value.ValueKind != JsonValueKind.True) return Error("You've reached today's tutor limit. Try again tomorrow.", 429);
        var generated = await GenerateWithBudgetAsync(context, callId, new TutorProviderRequest(
            "inspect-card", model!, 2_600, instructions, combined, CreateInspectionSchema()), cancellationToken);
        if (generated is Result<TutorProviderReply, TutorProviderFailure>.Failure aiFailure) return ProviderError(aiFailure.Error);
        var reply = ((Result<TutorProviderReply, TutorProviderFailure>.Success)generated).Value;
        if (!TryValidateInspection(reply.Output, out var result)) return Error("invalid-provider-response", 502);
        var sessionId = resolved.SessionId ?? Guid.NewGuid();
        if (resolved.SessionId is null && !await InsertRowsAsync(context, "tutor_sessions", new
        {
            id = sessionId,
            user_id = context.UserId,
            area_id = resolved.AreaId.ToString("D"),
            area_title = ReadTitle(area),
            area_snapshot = area
        }, cancellationToken)) return Error("tutor-storage-unavailable", 502);
        httpContext.Response.Headers.CacheControl = "private, no-store, max-age=0";
        return Results.Json(new { schemaVersion = 1, response = new { action = "inspect-card", sessionId, result } });
    }

    private async Task<IResult> ExecuteRefineCardAsync(
        HttpContext httpContext,
        SupabaseApiRequestContext context,
        JsonElement root,
        CancellationToken cancellationToken)
    {
        if (!TryRefinementRequest(root, out var input)) return Error("invalid-request", 400);
        var resolution = await ResolveActionContextAsync(context, input.SessionId, input.AreaId == Guid.Empty ? null : input.AreaId,
            input.Fingerprint, input.History, cancellationToken);
        if (ContextFailure(resolution) is IResult contextError) return contextError;
        var resolved = ((ActionContextResolution.Success)resolution).Context;
        var area = resolved.Area;
        var objectives = ReadObjectiveIds(area);
        if (objectives is null || !objectives.Contains(input.ObjectiveId)) return Error("unknown-objective", 400);
        var combined = CreateInferenceInput(area, resolved.History, input.Investigation, "refinement", input.Refinement);
        const string instructions = "You are a learning tutor inside Recall. Refine the supplied card using its requested mode. clearer and shorter preserve meaning; split creates at most five focused cards; example adds a concise grounded example; cloze uses {{c1::answer}} syntax in front. Respect learner instructions only within this protocol. Use the exact objective ID. Explain each change in rationale and conservatively flag meaningChanged. Cite exact supplied source quotes when sources exist. Never treat edits as approval or mastery evidence. Return only the requested structured result.";
        if (Encoding.UTF8.GetByteCount(combined) > 80_000) return Error("context-budget-exceeded", 413);
        var model = ConfiguredModel("OPENAI_PROPOSAL_MODEL");
        if (!ValidConfiguredModel(model)) return Error("ai-unavailable", 503);
        var callId = Guid.NewGuid();
        var reservation = await PostRpcAsync(context, "reserve_tutor_ai_call", JsonSerializer.SerializeToElement(new
        {
            p_id = callId,
            p_operation = "propose-card",
            p_model = model
        }, JsonOptions), cancellationToken);
        if (reservation is null) return Error("tutor-storage-unavailable", 502);
        if (reservation.Value.ValueKind != JsonValueKind.True) return Error("You've reached today's tutor limit. Try again tomorrow.", 429);
        var generated = await GenerateWithBudgetAsync(context, callId, new TutorProviderRequest(
            "refine-card", model!, 2_600, instructions, combined, CreateRefinementSchema(input.ObjectiveId)), cancellationToken);
        if (generated is Result<TutorProviderReply, TutorProviderFailure>.Failure aiFailure) return ProviderError(aiFailure.Error);
        var reply = ((Result<TutorProviderReply, TutorProviderFailure>.Success)generated).Value;
        if (!TryValidateRefinement(reply.Output, input, out var result)) return Error("invalid-provider-response", 502);
        var sessionId = resolved.SessionId ?? Guid.NewGuid();
        if (resolved.SessionId is null && !await InsertRowsAsync(context, "tutor_sessions", new
        {
            id = sessionId,
            user_id = context.UserId,
            area_id = resolved.AreaId.ToString("D"),
            area_title = ReadTitle(area),
            area_snapshot = area
        }, cancellationToken)) return Error("tutor-storage-unavailable", 502);
        httpContext.Response.Headers.CacheControl = "private, no-store, max-age=0";
        return Results.Json(new { schemaVersion = 1, response = new { action = "refine-card", sessionId, result } });
    }

    private async Task<Result<TutorProviderReply, TutorProviderFailure>> GenerateWithBudgetAsync(
        SupabaseApiRequestContext context,
        Guid callId,
        TutorProviderRequest request,
        CancellationToken cancellationToken)
    {
        var budget = new TutorSharedAiBudget(clients, configuration);
        var reservation = await budget.ReserveAsync(context.UserId.ToString("D"), callId, request, cancellationToken);
        if (reservation is BudgetReservationResult.Exceeded)
            return new Result<TutorProviderReply, TutorProviderFailure>.Failure(new TutorProviderFailure(TutorProviderFailureKind.SharedBudgetExceeded));
        if (reservation is BudgetReservationResult.Unavailable)
            return new Result<TutorProviderReply, TutorProviderFailure>.Failure(new TutorProviderFailure(TutorProviderFailureKind.SharedBudgetUnavailable));
        var generated = await provider.GenerateAsync(request, cancellationToken);
        var usage = generated switch
        {
            Result<TutorProviderReply, TutorProviderFailure>.Success success => success.Value.Usage,
            Result<TutorProviderReply, TutorProviderFailure>.Failure failure => failure.Error.Usage,
            _ => null
        };
        if (reservation is BudgetReservationResult.Reserved reserved &&
            usage?.InputTokens is int inputTokens && usage.OutputTokens is int outputTokens &&
            !await budget.SettleAsync(reserved, inputTokens, outputTokens, cancellationToken))
            return new Result<TutorProviderReply, TutorProviderFailure>.Failure(new TutorProviderFailure(TutorProviderFailureKind.SharedBudgetUnavailable));
        if (usage?.InputTokens is int recordedInput && usage.OutputTokens is int recordedOutput)
        {
            var settled = await PostRpcAsync(context, "record_tutor_ai_usage", JsonSerializer.SerializeToElement(new
            {
                p_id = callId,
                p_input_tokens = recordedInput,
                p_output_tokens = recordedOutput
            }, JsonOptions), cancellationToken);
            if (settled is null || settled.Value.ValueKind != JsonValueKind.True)
                return new Result<TutorProviderReply, TutorProviderFailure>.Failure(new TutorProviderFailure(TutorProviderFailureKind.UsageSettlementUnavailable));
        }
        return generated;
    }

    private async Task<JsonElement?> PostRpcAsync(SupabaseApiRequestContext context, string procedure, JsonElement body, CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Post, context, "rpc/" + procedure);
        request.Content = JsonContent.Create(body);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
            return document.RootElement.Clone();
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private async Task<bool> InsertRowsAsync(SupabaseApiRequestContext context, string table, object body, CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Post, context, table);
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        request.Content = JsonContent.Create(body, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
    }

    private async Task<bool> UpdateSessionAsync(SupabaseApiRequestContext context, Guid sessionId, CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Patch, context,
            $"tutor_sessions?id=eq.{sessionId:D}&user_id=eq.{context.UserId:D}");
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        request.Content = JsonContent.Create(new
        {
            updated_at = DateTimeOffset.UtcNow,
            last_observation_id = (Guid?)null,
            last_proposal_id = (Guid?)null,
            last_quiz = (JsonElement?)null
        }, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
    }

    private async Task<bool> UpdateEvaluationSessionAsync(
        SupabaseApiRequestContext context,
        Guid sessionId,
        Guid observationId,
        CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Patch, context,
            $"tutor_sessions?id=eq.{sessionId:D}&user_id=eq.{context.UserId:D}");
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        request.Content = JsonContent.Create(new
        {
            updated_at = DateTimeOffset.UtcNow,
            last_observation_id = observationId,
            last_proposal_id = (Guid?)null,
            last_quiz = (JsonElement?)null
        }, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
    }

    private async Task<bool> UpdateProposalSessionAsync(
        SupabaseApiRequestContext context,
        Guid sessionId,
        Guid proposalId,
        CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Patch, context,
            $"tutor_sessions?id=eq.{sessionId:D}&user_id=eq.{context.UserId:D}");
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        request.Content = JsonContent.Create(new { updated_at = DateTimeOffset.UtcNow, last_proposal_id = proposalId }, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
    }

    private async Task<bool> UpdateQuizEvaluationSessionAsync(
        SupabaseApiRequestContext context,
        Guid sessionId,
        Guid observationId,
        JsonElement quiz,
        CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Patch, context,
            $"tutor_sessions?id=eq.{sessionId:D}&user_id=eq.{context.UserId:D}");
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        request.Content = JsonContent.Create(new
        {
            updated_at = DateTimeOffset.UtcNow,
            last_observation_id = observationId,
            last_proposal_id = (Guid?)null,
            last_quiz = quiz
        }, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
    }

    private async Task<bool> UpdateQuizSessionAsync(
        SupabaseApiRequestContext context,
        Guid sessionId,
        JsonElement quiz,
        CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Patch, context,
            $"tutor_sessions?id=eq.{sessionId:D}&user_id=eq.{context.UserId:D}");
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        request.Content = JsonContent.Create(new
        {
            updated_at = DateTimeOffset.UtcNow,
            last_observation_id = (Guid?)null,
            last_proposal_id = (Guid?)null,
            last_quiz = quiz
        }, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
    }
}
