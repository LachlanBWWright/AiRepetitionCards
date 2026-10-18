using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private async Task<JsonElement?> GetRowsAsync(SupabaseApiRequestContext context, string path, CancellationToken token)
    {
        using var request = CreateRequest(HttpMethod.Get, context, path);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
            return document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement.Clone() : null;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private async Task<bool> LinkApprovedProposalRevisionAsync(
        SupabaseApiRequestContext context, Guid proposalId, CancellationToken token)
    {
        var proposals = await GetRowsAsync(context,
            $"generated_card_proposals?select=id,session_id,state,content,approved_card_id,approved_revision_id&id=eq.{proposalId:D}&user_id=eq.{context.UserId:D}&limit=1", token);
        if (proposals is null || proposals.Value.GetArrayLength() != 1) return false;
        var proposal = proposals.Value[0];
        if (!TryString(proposal, "state", out var state) || state != "approved" ||
            !proposal.TryGetProperty("session_id", out var sessionIdValue) || sessionIdValue.ValueKind != JsonValueKind.String ||
            !TryUuid(sessionIdValue.GetString(), out var sessionId) ||
            !proposal.TryGetProperty("approved_card_id", out var cardIdValue) || cardIdValue.ValueKind != JsonValueKind.String ||
            !TryUuid(cardIdValue.GetString(), out var cardId) || cardId != proposalId ||
            !proposal.TryGetProperty("content", out var content) || !IsProposalContent(content) ||
            !proposal.TryGetProperty("approved_revision_id", out var linkedRevision) ||
            (linkedRevision.ValueKind != JsonValueKind.Null &&
             (linkedRevision.ValueKind != JsonValueKind.String || !TryUuid(linkedRevision.GetString(), out _)))) return false;
        var sessionRows = await GetRowsAsync(context,
            $"tutor_sessions?select=area_id&id=eq.{sessionId:D}&user_id=eq.{context.UserId:D}&limit=1", token);
        if (sessionRows is null || sessionRows.Value.GetArrayLength() != 1 ||
            !sessionRows.Value[0].TryGetProperty("area_id", out var areaValue) || areaValue.ValueKind != JsonValueKind.String ||
            !TryUuid(areaValue.GetString(), out var areaId)) return false;
        var areaRows = await GetRowsAsync(context,
            $"knowledge_areas?select=id&id=eq.{areaId:D}&owner_id=eq.{context.UserId:D}&limit=1", token);
        if (areaRows is null || areaRows.Value.GetArrayLength() != 1) return false;
        var cardRows = await GetRowsAsync(context,
            $"cards?select=id&id=eq.{cardId:D}&knowledge_area_id=eq.{areaId:D}&limit=1", token);
        if (cardRows is null) return false;
        if (cardRows.Value.GetArrayLength() == 0)
            return linkedRevision.ValueKind == JsonValueKind.Null;

        var revisions = await GetRowsAsync(context,
            $"card_revisions?select=id,content&card_id=eq.{cardId:D}&created_by=eq.{context.UserId:D}&creator_type=eq.ai&order=revision.asc&limit=100", token);
        if (revisions is null) return false;
        JsonElement? matching = null;
        foreach (var revision in revisions.Value.EnumerateArray())
        {
            if (!TryString(revision, "id", out var revisionIdText) || !TryUuid(revisionIdText, out var revisionId) ||
                !revision.TryGetProperty("content", out var revisionContent) || revisionContent.ValueKind != JsonValueKind.Object)
                return false;
            if (linkedRevision.ValueKind == JsonValueKind.String && revisionIdText != linkedRevision.GetString()) continue;
            if (!revisionContent.TryGetProperty("objectiveIds", out var objectiveIds) || objectiveIds.ValueKind != JsonValueKind.Array)
                continue;
            var expectedObjectives = content.GetProperty("objectiveId").ValueKind == JsonValueKind.Null
                ? Array.Empty<string>()
                : [content.GetProperty("objectiveId").GetString() ?? string.Empty];
            var actualObjectives = objectiveIds.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString() ?? string.Empty).ToArray();
            if (actualObjectives.Length != expectedObjectives.Length || !actualObjectives.SequenceEqual(expectedObjectives, StringComparer.Ordinal))
                continue;
            if (!TryString(revisionContent, "id", out var contentCardId) || contentCardId != cardId.ToString("D") ||
                !TryString(revisionContent, "kind", out var kind) || kind != "basic" ||
                !TryString(revisionContent, "origin", out var origin) || origin != "ai-generated" ||
                !TryString(revisionContent, "sourceId", out var sourceId) || sourceId != $"tutor:{sessionId:D}:{proposalId:D}" ||
                !TryString(revisionContent, "front", out var front) || front != content.GetProperty("front").GetString() ||
                !TryString(revisionContent, "back", out var back) || back != content.GetProperty("back").GetString()) continue;
            matching = revision.Clone();
            break;
        }
        if (matching is null)
        {
            if (linkedRevision.ValueKind != JsonValueKind.Null || revisions.Value.GetArrayLength() > 0) return false;
            return true;
        }
        if (linkedRevision.ValueKind == JsonValueKind.String) return true;
        if (!TryAdminConfiguration(out var baseUri, out var serviceKey)) return false;
        using var update = CreateAdminRequest(HttpMethod.Patch, new Uri(baseUri,
            $"rest/v1/generated_card_proposals?id=eq.{proposalId:D}&user_id=eq.{context.UserId:D}&session_id=eq.{sessionId:D}&state=eq.approved&approved_card_id=eq.{cardId:D}&approved_revision_id=is.null"), serviceKey);
        update.Headers.TryAddWithoutValidation("Prefer", "return=representation");
        update.Content = JsonContent.Create(new { approved_revision_id = matching.Value.GetProperty("id").GetString() }, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(update, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode) return false;
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
            if (document.RootElement.ValueKind == JsonValueKind.Array && document.RootElement.GetArrayLength() == 1) return true;
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return false; }
        catch (JsonException) { return false; }
        catch (IOException) { return false; }
        var persisted = await GetRowsAsync(context,
            $"generated_card_proposals?select=approved_revision_id&id=eq.{proposalId:D}&user_id=eq.{context.UserId:D}&state=eq.approved&limit=1", token);
        return persisted is not null && persisted.Value.GetArrayLength() == 1 &&
            persisted.Value[0].TryGetProperty("approved_revision_id", out var persistedId) &&
            persistedId.ValueKind == JsonValueKind.String && persistedId.GetString() == matching.Value.GetProperty("id").GetString();
    }

    private bool TryAdminConfiguration(out Uri baseUri, out string key)
    {
        var projectUrl = configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"];
        key = configuration["SUPABASE_SERVICE_ROLE_KEY"]?.Trim() ?? string.Empty;
        if (!Uri.TryCreate(projectUrl, UriKind.Absolute, out var projectUri) ||
            (projectUri.Scheme != Uri.UriSchemeHttps &&
             !(projectUri.Scheme == Uri.UriSchemeHttp && projectUri.IsLoopback)) || key.Length == 0)
        {
            baseUri = new Uri("https://invalid.invalid/");
            return false;
        }
        baseUri = new Uri(projectUri, "/");
        return true;
    }

    private static HttpRequestMessage CreateAdminRequest(HttpMethod method, Uri uri, string key)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.TryAddWithoutValidation("apikey", key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    private static bool TryValidateKnowledgeArea(JsonElement area)
    {
        if (area.ValueKind != JsonValueKind.Object || !TryString(area, "schemaVersion", out var version) || version != "1.0.0" ||
            !TryString(area, "id", out _) || !TryString(area, "title", out var title) || title.Length > 80 ||
            !area.TryGetProperty("description", out var description) || !(description.ValueKind is JsonValueKind.Null or JsonValueKind.String) ||
            !TryString(area, "language", out _) || !area.TryGetProperty("objectives", out var objectives) || objectives.ValueKind != JsonValueKind.Array || objectives.GetArrayLength() > 200 ||
            !area.TryGetProperty("ai", out var ai) || !TryString(ai, "tutorInstructions", out var tutorInstructions) || tutorInstructions.Length > 2_000 ||
            !OptionalNullString(ai, "quizInstructions", 2_000) || !OptionalNullString(ai, "cardGenerationInstructions", 2_000) ||
            !area.TryGetProperty("cards", out var cards) || cards.ValueKind != JsonValueKind.Array || cards.GetArrayLength() > 500 ||
            !area.TryGetProperty("tags", out var tags) || !IsStringArray(tags) ||
            !area.TryGetProperty("licence", out var licence) || !(licence.ValueKind is JsonValueKind.Null or JsonValueKind.String)) return false;
        foreach (var objective in objectives.EnumerateArray())
        {
            if (!TryString(objective, "id", out _) || !TryString(objective, "title", out _) ||
                !objective.TryGetProperty("description", out var objectiveDescription) || !(objectiveDescription.ValueKind is JsonValueKind.Null or JsonValueKind.String) ||
                !objective.TryGetProperty("prerequisiteIds", out var prerequisites) || !IsStringArray(prerequisites)) return false;
        }
        foreach (var card in cards.EnumerateArray())
        {
            if (!TryString(card, "kind", out var kind) || kind is not ("basic" or "cloze") || !TryString(card, "id", out _) ||
                !card.TryGetProperty("objectiveIds", out var objectiveIds) || !IsStringArray(objectiveIds) ||
                !card.TryGetProperty("tags", out var cardTags) || !IsStringArray(cardTags) ||
                !TryString(card, "origin", out var origin) || origin is not ("authored" or "imported" or "ai-generated")) return false;
            if (kind == "basic" && (!TryString(card, "front", out _) || !TryString(card, "back", out _))) return false;
            if (kind == "cloze" && (!TryString(card, "text", out var text) || text.Length > 20_000)) return false;
            if (kind == "cloze" && card.TryGetProperty("deletionIndex", out var deletion) &&
                (!deletion.TryGetInt32(out var deletionIndex) || deletionIndex is < 1 or > 20)) return false;
            if (card.TryGetProperty("media", out var media) && (media.ValueKind != JsonValueKind.Array || media.GetArrayLength() > 20 ||
                media.EnumerateArray().Any(item => !TryString(item, "id", out _) || !TryString(item, "mimeType", out var mime) ||
                    mime is not ("image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav") ||
                    !item.TryGetProperty("byteLength", out var length) || !length.TryGetInt32(out var bytes) || bytes is < 1 or > 20_000_000))) return false;
        }
        if (area.TryGetProperty("attribution", out var attribution) && attribution.ValueKind != JsonValueKind.Null &&
            (attribution.ValueKind != JsonValueKind.String || (attribution.GetString()?.Length ?? 0) > 500)) return false;
        if (area.TryGetProperty("forkedFromVersionId", out var forked) && (forked.ValueKind != JsonValueKind.String || (forked.GetString()?.Length ?? 0) > 80)) return false;
        if (area.TryGetProperty("sourceId", out var sourceId) && sourceId.ValueKind != JsonValueKind.String) return false;
        return true;
    }

    private static bool OptionalNullString(JsonElement value, string property, int maxLength) =>
        value.TryGetProperty(property, out var item) && (item.ValueKind == JsonValueKind.Null ||
            item.ValueKind == JsonValueKind.String && (item.GetString()?.Length ?? 0) <= maxLength);

    private static bool IsStringArray(JsonElement value) => value.ValueKind == JsonValueKind.Array &&
        value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String);

    private static bool TryValidateAreaObjectives(JsonElement area, out IReadOnlyList<string> objectiveIds)
    {
        objectiveIds = [];
        var objectives = ReadObjectives(area);
        if (objectives is null) return false;
        objectiveIds = objectives.Select(objective => objective.Id).ToArray();
        return true;
    }

    private static bool TryValidateStoredQuiz(JsonElement quiz, JsonElement area, IReadOnlyList<string> objectiveIds, out JsonElement canonical)
    {
        canonical = default;
        if (!TryString(quiz, "objectiveId", out var objectiveId) || !objectiveIds.Contains(objectiveId) ||
            !TryString(quiz, "objectiveTitle", out var title) || !quiz.TryGetProperty("questions", out var questions) ||
            questions.ValueKind != JsonValueKind.Array || questions.GetArrayLength() is < 2 or > 5) return false;
        var objectives = ReadObjectives(area);
        var objective = objectives?.FirstOrDefault(item => item.Id == objectiveId);
        if (objective is null || objective.Title != title) return false;
        var canonicalQuestions = new List<StoredQuizQuestion>();
        foreach (var question in questions.EnumerateArray())
        {
            if (!TryString(question, "prompt", out var prompt) || prompt.Length > 1_000 ||
                !TryString(question, "expectedAnswer", out var expected) || expected.Length > 2_000 ||
                !question.TryGetProperty("learnerAnswer", out var learnerAnswer) ||
                !(learnerAnswer.ValueKind == JsonValueKind.Null || learnerAnswer.ValueKind == JsonValueKind.String &&
                    (learnerAnswer.GetString()?.Length ?? 0) <= 8_000) ||
                !question.TryGetProperty("evaluation", out var evaluation)) return false;
            EvaluationResult? parsedEvaluation = null;
            if (evaluation.ValueKind != JsonValueKind.Null)
            {
                if (!TryValidateEvaluation(evaluation, objectiveIds, out var parsed) || parsed.ObjectiveId != objectiveId) return false;
                parsedEvaluation = parsed;
            }
            canonicalQuestions.Add(new StoredQuizQuestion(prompt, expected,
                learnerAnswer.ValueKind == JsonValueKind.Null ? null : learnerAnswer.GetString(),
                parsedEvaluation?.ToWire()));
        }
        canonical = JsonSerializer.SerializeToElement(new StoredQuiz(objectiveId, title, canonicalQuestions), JsonOptions);
        return true;
    }
}
