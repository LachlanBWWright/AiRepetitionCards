using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private static bool TryQuestionRequest(JsonElement root, out QuestionInput input, out string error)
    {
        input = default!;
        error = "invalid-request";
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var version) ||
            !version.TryGetInt32(out var versionValue) || versionValue != 1 ||
            !root.TryGetProperty("request", out var request) || request.ValueKind != JsonValueKind.Object ||
            !TryString(request, "action", out var action) || action != "question")
            return false;
        Guid? sessionId = null;
        if (request.TryGetProperty("sessionId", out var sessionValue) && sessionValue.ValueKind != JsonValueKind.Null)
        {
            if (sessionValue.ValueKind != JsonValueKind.String || !TryUuid(sessionValue.GetString(), out var parsed) || parsed == Guid.Empty)
                return false;
            sessionId = parsed;
        }
        JsonElement? area = null;
        var fingerprint = string.Empty;
        JsonElement? investigation = null;
        JsonElement? improvement = null;
        var ephemeralSession = false;
        var parsedHistory = new List<TutorHistoryEntry>();
        if (request.TryGetProperty("context", out var context))
        {
            if (context.ValueKind != JsonValueKind.Object || !context.TryGetProperty("knowledgeArea", out var areaValue) ||
                areaValue.ValueKind != JsonValueKind.Object || !TryValidateKnowledgeArea(areaValue) ||
                !context.TryGetProperty("history", out var history) || history.ValueKind != JsonValueKind.Array || history.GetArrayLength() > 40)
                return false;
            area = areaValue.Clone();
            if (context.TryGetProperty("investigation", out var investigationValue))
            {
                if (!TryValidateInvestigation(investigationValue)) return false;
                investigation = investigationValue.Clone();
            }
            if (context.TryGetProperty("improvement", out var improvementValue))
            {
                if (improvementValue.ValueKind != JsonValueKind.Object || !TryString(improvementValue, "goal", out var goal) || goal.Length > 2_000) return false;
                improvement = improvementValue.Clone();
            }
            if (context.TryGetProperty("ephemeralSession", out var ephemeral)) {
                if (ephemeral.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
                ephemeralSession = ephemeral.GetBoolean();
            }
            foreach (var item in history.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object || !TryString(item, "role", out var role) ||
                    role is not ("assistant" or "learner") || !TryString(item, "content", out var content) || content.Length > 8_000)
                    return false;
                parsedHistory.Add(new TutorHistoryEntry(role, content));
            }
            if (request.TryGetProperty("canonicalAreaFingerprint", out var fingerprintValue))
            {
                if (fingerprintValue.ValueKind != JsonValueKind.String) return false;
                fingerprint = fingerprintValue.GetString() ?? string.Empty;
                if (fingerprint.Length != 64 || fingerprint.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f'))) return false;
            }
        }
        if (sessionId is null && area is null) return false;
        if (fingerprint.Length > 0 && (fingerprint.Length != 64 || !fingerprint.All(Uri.IsHexDigit))) return false;
        input = new QuestionInput(area, parsedHistory, fingerprint, sessionId, investigation, improvement, ephemeralSession);
        return true;
    }

    private static string? ReadActionName(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("request", out var request) &&
        TryString(request, "action", out var action) ? action : null;

    private static bool TryReadActionContext(
        JsonElement request,
        out Guid? sessionId,
        out Guid? areaId,
        out string fingerprint,
        out IReadOnlyList<TutorHistoryEntry> history,
        out JsonElement? investigation)
    {
        investigation = null;
        sessionId = null;
        areaId = null;
        fingerprint = string.Empty;
        history = [];
        if (request.TryGetProperty("sessionId", out var session))
        {
            if (session.ValueKind != JsonValueKind.Null && (session.ValueKind != JsonValueKind.String ||
                !TryUuid(session.GetString(), out var id) || id == Guid.Empty)) return false;
            if (session.ValueKind == JsonValueKind.String && TryUuid(session.GetString(), out var parsed)) sessionId = parsed;
        }
        if (request.TryGetProperty("canonicalAreaFingerprint", out var fp))
        {
            if (fp.ValueKind != JsonValueKind.String) return false;
            fingerprint = fp.GetString() ?? string.Empty;
            if (fingerprint.Length != 64 || fingerprint.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f'))) return false;
        }
        if (!request.TryGetProperty("context", out var context)) return sessionId is not null;
        if (context.ValueKind != JsonValueKind.Object || !context.TryGetProperty("knowledgeArea", out var area) ||
            !TryString(area, "id", out var areaText) || !TryUuid(areaText, out var parsedArea) || parsedArea == Guid.Empty ||
            !TryValidateKnowledgeArea(area) || !context.TryGetProperty("history", out var historyJson) || historyJson.ValueKind != JsonValueKind.Array || historyJson.GetArrayLength() > 40)
            return false;
        areaId = parsedArea;
        if (context.TryGetProperty("investigation", out var investigationValue))
        {
            if (!TryValidateInvestigation(investigationValue)) return false;
            investigation = investigationValue.Clone();
        }
        var parsedHistory = ParseHistory(historyJson);
        if (parsedHistory is null) return false;
        history = parsedHistory;
        return true;
    }

    private static bool TryEvaluationRequest(JsonElement root, out Guid sessionId, out string answer)
    {
        sessionId = Guid.Empty;
        answer = string.Empty;
        return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("schemaVersion", out var version) &&
            version.TryGetInt32(out var v) && v == 1 && root.TryGetProperty("request", out var request) &&
            request.ValueKind == JsonValueKind.Object && TryString(request, "action", out var action) && action == "evaluate" &&
            TryString(request, "sessionId", out var id) && TryUuid(id, out sessionId) && sessionId != Guid.Empty &&
            TryString(request, "answer", out answer) && answer.Length <= 8_000;
    }

    private static bool TryQuizAnswerRequest(JsonElement root, out Guid sessionId, out int questionIndex, out string answer)
    {
        sessionId = Guid.Empty;
        questionIndex = -1;
        answer = string.Empty;
        return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("schemaVersion", out var version) &&
            version.TryGetInt32(out var v) && v == 1 && root.TryGetProperty("request", out var request) &&
            request.ValueKind == JsonValueKind.Object && TryString(request, "action", out var action) && action == "evaluate-quiz-answer" &&
            TryString(request, "sessionId", out var id) && TryUuid(id, out sessionId) && sessionId != Guid.Empty &&
            request.TryGetProperty("questionIndex", out var index) && index.TryGetInt32(out questionIndex) && questionIndex >= 0 &&
            TryString(request, "answer", out answer) && answer.Length <= 8_000;
    }

    private static bool TrySessionActionRequest(JsonElement root, string expectedAction, out Guid sessionId)
    {
        sessionId = Guid.Empty;
        return root.ValueKind == JsonValueKind.Object && root.TryGetProperty("schemaVersion", out var version) &&
            version.TryGetInt32(out var v) && v == 1 && root.TryGetProperty("request", out var request) &&
            request.ValueKind == JsonValueKind.Object && TryString(request, "action", out var action) && action == expectedAction &&
            TryString(request, "sessionId", out var id) && TryUuid(id, out sessionId) && sessionId != Guid.Empty;
    }

    private static bool TryTargetedQuizRequest(JsonElement root, out TargetedQuizInput input)
    {
        input = default!;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var version) ||
            !version.TryGetInt32(out var v) || v != 1 || !root.TryGetProperty("request", out var request) ||
            request.ValueKind != JsonValueKind.Object || !TryString(request, "action", out var action) || action != "targeted-quiz" ||
            !TryString(request, "objectiveId", out var objectiveId) ||
            !TryReadActionContext(request, out var sessionId, out var areaId, out var fingerprint, out var history, out var investigation))
            return false;
        input = new TargetedQuizInput(sessionId, areaId, objectiveId, fingerprint, history, investigation);
        return true;
    }

    private static bool TryStudyCardRequest(JsonElement root, out StudyCardInput input)
    {
        input = default!;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var version) ||
            !version.TryGetInt32(out var v) || v != 1 || !root.TryGetProperty("request", out var request) ||
            request.ValueKind != JsonValueKind.Object || !TryString(request, "action", out var action) || action != "study-card" ||
            !TryReadActionContext(request, out var sessionId, out var areaId, out var fingerprint, out var history, out var investigation) ||
            !request.TryGetProperty("material", out var material) || material.ValueKind != JsonValueKind.Object ||
            !TryString(material, "goal", out var goal) || goal.Length > 2_000 || !TryString(material, "depth", out var depth) ||
            depth is not ("overview" or "standard" or "detailed") || !TryNullableString(material, "objectiveId", out var objectiveId) ||
            !material.TryGetProperty("sources", out var sources) || sources.ValueKind != JsonValueKind.Array || sources.GetArrayLength() != 1 ||
            !material.TryGetProperty("previousFronts", out var previousFronts) || previousFronts.ValueKind != JsonValueKind.Array || previousFronts.GetArrayLength() > 30)
            return false;
        var source = sources[0];
        if (!TryString(source, "materialId", out var materialIdText) || !TryUuid(materialIdText, out var materialId) ||
            !TryString(source, "sectionId", out var sectionIdText) || !TryUuid(sectionIdText, out var sectionId) ||
            !TryString(source, "text", out var sourceText) || sourceText.Length > 12_000 ||
            !TryNullablePositiveInt(source, "pageNumber", out var pageNumber)) return false;
        StudyClaim? claim = null;
        if (material.TryGetProperty("claim", out var claimJson) && claimJson.ValueKind != JsonValueKind.Null)
        {
            if (!TryString(claimJson, "title", out var claimTitle) || claimTitle.Length > 200 ||
                !TryString(claimJson, "description", out var claimDescription) || claimDescription.Length > 2_000) return false;
            claim = new StudyClaim(claimTitle, claimDescription);
        }
        var fronts = new List<string>();
        foreach (var front in previousFronts.EnumerateArray())
            if (front.ValueKind != JsonValueKind.String || (front.GetString()?.Length ?? 0) > 1_000) return false;
            else fronts.Add(front.GetString() ?? string.Empty);
        input = new StudyCardInput(sessionId, areaId ?? Guid.Empty, fingerprint, history, investigation, goal, depth, objectiveId,
            new StudySource(materialId, sectionId, sourceText, pageNumber), fronts, claim);
        return true;
    }

    private static bool TryPlanStudyRequest(JsonElement root, out PlanStudyInput input)
    {
        input = default!;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32(out var v) || v != 1 ||
            !root.TryGetProperty("request", out var request) || request.ValueKind != JsonValueKind.Object ||
            !TryString(request, "action", out var action) || action != "plan-study" ||
            !TryReadActionContext(request, out var sessionId, out var areaId, out var fingerprint, out var history, out var investigation) ||
            !request.TryGetProperty("material", out var material) || material.ValueKind != JsonValueKind.Object ||
            !TryString(material, "goal", out var goal) || goal.Length > 2_000 || !TryString(material, "depth", out var depth) || depth is not ("overview" or "standard" or "detailed") ||
            !material.TryGetProperty("sources", out var sources) || sources.ValueKind != JsonValueKind.Array || sources.GetArrayLength() != 1)
            return false;
        var sourceJson = sources[0];
        if (!TryString(sourceJson, "materialId", out var materialText) || !TryUuid(materialText, out var materialId) ||
            !TryString(sourceJson, "sectionId", out var sectionText) || !TryUuid(sectionText, out var sectionId) ||
            !TryString(sourceJson, "text", out var text) || text.Length > 12_000 || !TryNullablePositiveInt(sourceJson, "pageNumber", out var page)) return false;
        input = new PlanStudyInput(sessionId, areaId ?? Guid.Empty, fingerprint, history, investigation, goal, depth, new StudySource(materialId, sectionId, text, page));
        return true;
    }

    private static bool TryInspectRequest(JsonElement root, out InspectionInput input)
    {
        input = default!;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32(out var v) || v != 1 ||
            !root.TryGetProperty("request", out var request) || request.ValueKind != JsonValueKind.Object ||
            !TryString(request, "action", out var action) || action != "inspect-card" ||
            !TryReadActionContext(request, out var sessionId, out var areaId, out var fingerprint, out var history, out var investigation) ||
            !request.TryGetProperty("inspection", out var inspection) || inspection.ValueKind != JsonValueKind.Object ||
            !TryString(inspection, "front", out var front) || front.Length > 1_000 || !TryString(inspection, "back", out var back) || back.Length > 3_000 ||
            !TryNullableString(inspection, "objectiveId", out var objectiveId) ||
            !TryStudySources(inspection, out var sources)) return false;
        input = new InspectionInput(sessionId, areaId ?? Guid.Empty, fingerprint, history, investigation, objectiveId, new { front, back, objectiveId, sources });
        return true;
    }

    private static bool TryRefinementRequest(JsonElement root, out RefinementInput input)
    {
        input = default!;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("schemaVersion", out var version) || !version.TryGetInt32(out var v) || v != 1 ||
            !root.TryGetProperty("request", out var request) || request.ValueKind != JsonValueKind.Object ||
            !TryString(request, "action", out var action) || action != "refine-card" ||
            !TryReadActionContext(request, out var sessionId, out var areaId, out var fingerprint, out var history, out var investigation) ||
            !request.TryGetProperty("refinement", out var refinement) || refinement.ValueKind != JsonValueKind.Object ||
            !TryString(refinement, "front", out var front) || front.Length > 1_000 || !TryString(refinement, "back", out var back) || back.Length > 3_000 ||
            !TryNullableString(refinement, "objectiveId", out var objectiveId) ||
            !TryString(refinement, "mode", out var mode) || mode is not ("clearer" or "shorter" or "split" or "example" or "cloze") ||
            !TryString(refinement, "instructions", out var instructions) && !refinement.TryGetProperty("instructions", out var emptyInstructions) ||
            refinement.TryGetProperty("instructions", out var instructionsValue) &&
                (instructionsValue.ValueKind != JsonValueKind.String || (instructionsValue.GetString()?.Length ?? 0) > 1_000) ||
            !TryStudySources(refinement, out var sources)) return false;
        var instructionsText = refinement.TryGetProperty("instructions", out var instructionValue) ? instructionValue.GetString() ?? string.Empty : string.Empty;
        input = new RefinementInput(sessionId, areaId ?? Guid.Empty, fingerprint, history, investigation, objectiveId,
            new { front, back, objectiveId, mode, instructions = instructionsText, sources }, mode, sources);
        return true;
    }
}
