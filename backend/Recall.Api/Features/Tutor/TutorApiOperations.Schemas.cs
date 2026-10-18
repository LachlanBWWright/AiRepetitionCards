using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private string? ConfiguredModel(string taskKey)
    {
        var taskModel = configuration[taskKey];
        return taskModel is not null && taskModel.Length > 0 ? taskModel : configuration["OPENAI_MODEL"];
    }

    private bool ValidConfiguredModel(string? model) => !string.IsNullOrWhiteSpace(configuration["OPENAI_API_KEY"]) &&
        !string.IsNullOrWhiteSpace(model) && model.Length <= 120 && model.Trim() == model && !model.Any(char.IsWhiteSpace);

    private static JsonElement CreateProposalSchema(IReadOnlyList<string> objectiveIds) => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new Dictionary<string, object>
        {
            ["front"] = new { type = "string", minLength = 1, maxLength = 1_000 },
            ["back"] = new { type = "string", minLength = 1, maxLength = 3_000 },
            ["objectiveId"] = new { @enum = objectiveIds.Cast<object>().Append((object?)null).ToArray() },
            ["rationale"] = new { type = "string", minLength = 1, maxLength = 1_000 }
        },
        required = new[] { "front", "back", "objectiveId", "rationale" }
    }, JsonOptions);

    private static JsonElement CreateEvaluationSchema(IReadOnlyList<string> objectiveIds) => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new Dictionary<string, object>
        {
            ["result"] = new { type = "string", @enum = new[] { "mastered", "partial", "incorrect", "uncertain" } },
            ["confidence"] = new { type = "number", minimum = 0, maximum = 1 },
            ["feedback"] = new { type = "string", minLength = 1, maxLength = 3_000 },
            ["misconception"] = new { type = new[] { "string", "null" }, maxLength = 1_000 },
            ["objectiveId"] = new { @enum = objectiveIds.Cast<object>().Append((object?)null).ToArray() },
            ["suggestedAction"] = new { type = "string", @enum = new[] { "review-existing-card", "propose-card", "targeted-quiz", "explain", "none" } }
        },
        required = new[] { "result", "confidence", "feedback", "misconception", "objectiveId", "suggestedAction" }
    }, JsonOptions);

    private static bool TryValidateEvaluation(JsonElement output, IReadOnlyList<string> objectiveIds, out EvaluationResult result)
    {
        result = default!;
        if (output.ValueKind != JsonValueKind.Object || !TryString(output, "result", out var mastery) ||
            mastery is not ("mastered" or "partial" or "incorrect" or "uncertain") ||
            !output.TryGetProperty("confidence", out var confidenceValue) || !confidenceValue.TryGetDouble(out var confidence) ||
            !double.IsFinite(confidence) || confidence is < 0 or > 1 || !TryString(output, "feedback", out var feedback) || feedback.Length > 3_000 ||
            !output.TryGetProperty("misconception", out var misconceptionValue) ||
            !(misconceptionValue.ValueKind == JsonValueKind.Null || misconceptionValue.ValueKind == JsonValueKind.String && (misconceptionValue.GetString()?.Length ?? 0) <= 1_000) ||
            !output.TryGetProperty("objectiveId", out var objectiveValue) ||
            !(objectiveValue.ValueKind == JsonValueKind.Null || objectiveValue.ValueKind == JsonValueKind.String && objectiveIds.Contains(objectiveValue.GetString() ?? string.Empty)) ||
            !TryString(output, "suggestedAction", out var suggested) ||
            suggested is not ("review-existing-card" or "propose-card" or "targeted-quiz" or "explain" or "none")) return false;
        result = new EvaluationResult(mastery, confidence, feedback,
            misconceptionValue.ValueKind == JsonValueKind.Null ? null : misconceptionValue.GetString(),
            objectiveValue.ValueKind == JsonValueKind.Null ? null : objectiveValue.GetString(), suggested);
        return true;
    }

    private static JsonElement CreateQuestionSchema(IReadOnlyList<string> objectiveIds)
    {
        var objectiveEnum = objectiveIds.Cast<object>().Append((object?)null).ToArray();
        return JsonSerializer.SerializeToElement(new
        {
            type = "object",
            additionalProperties = false,
            properties = new Dictionary<string, object>
            {
                ["proposal"] = new { anyOf = new object[] { CreateProposalSchema(objectiveIds), new { type = "null" } } },
                ["question"] = new { type = "string", minLength = 1, maxLength = 2_000 },
                ["objectiveId"] = new { @enum = objectiveEnum },
                ["teachingIntent"] = new { type = "string", minLength = 1, maxLength = 500 },
                ["explanation"] = new { type = new[] { "string", "null" }, maxLength = 3_000 },
                ["conceptSuggestions"] = new
                {
                    type = "array",
                    maxItems = 8,
                    items = new
                    {
                        type = "object",
                        additionalProperties = false,
                        properties = new { title = new { type = "string", minLength = 1, maxLength = 200 }, description = new { type = "string", minLength = 1, maxLength = 1_000 } },
                        required = new[] { "title", "description" }
                    }
                }
            },
            required = new[] { "question", "objectiveId", "teachingIntent", "explanation", "conceptSuggestions", "proposal" }
        }, JsonOptions);
    }

    private static bool TryValidateQuestion(JsonElement output, IReadOnlyList<string> objectiveIds, out QuestionResult result)
    {
        result = default!;
        if (output.ValueKind != JsonValueKind.Object || !TryString(output, "question", out var question) || question.Length > 2_000 ||
            !TryString(output, "teachingIntent", out var intent) || intent.Length > 500 ||
            !output.TryGetProperty("objectiveId", out var objective) ||
            !(objective.ValueKind == JsonValueKind.Null || objective.ValueKind == JsonValueKind.String && objectiveIds.Contains(objective.GetString() ?? string.Empty)) ||
            !output.TryGetProperty("explanation", out var explanation) ||
            !(explanation.ValueKind == JsonValueKind.Null || explanation.ValueKind == JsonValueKind.String && (explanation.GetString()?.Length ?? 0) is > 0 and <= 3_000) ||
            !output.TryGetProperty("conceptSuggestions", out var suggestions) || suggestions.ValueKind != JsonValueKind.Array || suggestions.GetArrayLength() > 8)
            return false;
        var concepts = new List<TutorConceptSuggestion>();
        foreach (var item in suggestions.EnumerateArray())
        {
            if (!TryString(item, "title", out var title) || title.Length > 200 ||
                !TryString(item, "description", out var description) || description.Length > 1_000) return false;
            concepts.Add(new TutorConceptSuggestion(title, description));
        }
        JsonElement? proposal = null;
        if (output.TryGetProperty("proposal", out var proposed) && proposed.ValueKind != JsonValueKind.Null)
        {
            if (!TryNormalizeProposalContent(proposed, out var canonical) || !TryNullableString(canonical, "objectiveId", out var proposalObjective) ||
                proposalObjective is not null && !objectiveIds.Contains(proposalObjective)) return false;
            proposal = canonical;
        }
        result = new QuestionResult(question, objective.ValueKind == JsonValueKind.Null ? null : objective.GetString(), intent,
            explanation.ValueKind == JsonValueKind.Null ? null : explanation.GetString(), concepts, proposal);
        return true;
    }

    private static IReadOnlyList<string>? ReadObjectiveIds(JsonElement area)
    {
        if (!area.TryGetProperty("objectives", out var objectives) || objectives.ValueKind != JsonValueKind.Array) return null;
        var ids = new List<string>();
        foreach (var objective in objectives.EnumerateArray())
            if (!TryString(objective, "id", out var id)) return null;
            else ids.Add(id);
        return ids;
    }

    private static string ReadTitle(JsonElement area) => TryString(area, "title", out var title) ? title : "Learning area";

    private static string Fingerprint(JsonElement value) => Convert.ToHexStringLower(
        System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(CanonicalJson(value))));

    private static string CanonicalJson(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => "{" + string.Join(',', value.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => JsonSerializer.Serialize(property.Name) + ":" + CanonicalJson(property.Value))) + "}",
        JsonValueKind.Array => "[" + string.Join(',', value.EnumerateArray().Select(CanonicalJson)) + "]",
        JsonValueKind.String => JsonSerializer.Serialize(value.GetString()),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => "null"
    };

    private static IResult ProviderError(TutorProviderFailure failure) => failure.Kind switch
    {
        TutorProviderFailureKind.RateLimited => Error("The tutor is busy. Try again shortly.", 429),
        TutorProviderFailureKind.SharedBudgetExceeded => Error("You have reached today’s hosted AI budget. Try again tomorrow.", 429),
        TutorProviderFailureKind.SharedBudgetUnavailable => Error("Hosted AI budgeting is temporarily unavailable. Try again later.", 503),
        TutorProviderFailureKind.UsageSettlementUnavailable => Error("tutor-storage-unavailable", 502),
        TutorProviderFailureKind.ProviderQuotaExceeded => Error("The hosted AI account has exhausted its quota. Ask the operator to check API funding.", 503),
        TutorProviderFailureKind.Refused => Error("The tutor could not help with that request. Try rephrasing it.", 503),
        TutorProviderFailureKind.ContextTooLarge => Error("context-budget-exceeded", 413),
        TutorProviderFailureKind.InvalidStructuredOutput => Error("The tutor response could not be validated. Try again.", 503),
        _ => Error("ai-unavailable", 503)
    };

    private sealed record QuestionInput(JsonElement? KnowledgeArea, IReadOnlyList<TutorHistoryEntry> History, string CanonicalAreaFingerprint, Guid? SessionId, JsonElement? Investigation, JsonElement? Improvement = null, bool EphemeralSession = false);
    private sealed record TutorHistoryEntry(string Role, string Content);
    private sealed record StoredQuiz(string ObjectiveId, string ObjectiveTitle, IReadOnlyList<StoredQuizQuestion> Questions);
    private sealed record StoredQuizQuestion(string Prompt, string ExpectedAnswer, string? LearnerAnswer, object? Evaluation);
    private sealed record ResolvedActionContext(Guid AreaId, JsonElement Area, IReadOnlyList<TutorHistoryEntry> History, Guid? SessionId);
    private sealed record CanonicalAreaReadResult(JsonElement? Area, string? Failure, int Status);
    private abstract record ActionContextResolution
    {
        private ActionContextResolution() { }
        public sealed record Success(ResolvedActionContext Context) : ActionContextResolution;
        public sealed record Failure(string Code, int Status) : ActionContextResolution;
    }
    private sealed record TutorConceptSuggestion(string Title, string Description);
    private sealed record QuestionResult(
        string Question,
        string? ObjectiveId,
        string TeachingIntent,
        string? Explanation,
        IReadOnlyList<TutorConceptSuggestion> ConceptSuggestions, JsonElement? Proposal = null)
    {
        public object ToWire() => new
        {
            question = Question,
            objectiveId = ObjectiveId,
            teachingIntent = TeachingIntent,
            explanation = Explanation,
            conceptSuggestions = ConceptSuggestions,
            proposal = Proposal
        };
    }
    private sealed record EvaluationResult(string Result, double Confidence, string Feedback,
        string? Misconception, string? ObjectiveId, string SuggestedAction)
    {
        public object ToWire() => new
        {
            result = Result,
            confidence = Confidence,
            feedback = Feedback,
            misconception = Misconception,
            objectiveId = ObjectiveId,
            suggestedAction = SuggestedAction
        };
    }
    private sealed record TutorObjective(string Id, string Title);
    private sealed record QuizQuestion(string Prompt, string ExpectedAnswer);
    private sealed record TargetedQuizInput(Guid? SessionId, Guid? AreaId, string ObjectiveId, string Fingerprint, IReadOnlyList<TutorHistoryEntry> History, JsonElement? Investigation);
    private sealed record StudyClaim(string Title, string Description);
    private sealed record StudySource(Guid MaterialId, Guid SectionId, string Text, int? PageNumber);
    private sealed record StudySourceReference(Guid MaterialId, Guid SectionId, string Quote, int? PageNumber);
    private sealed record StudyCardInput(Guid? SessionId, Guid AreaId, string Fingerprint, IReadOnlyList<TutorHistoryEntry> History, JsonElement? Investigation,
        string Goal, string Depth, string? ObjectiveId, StudySource Source, IReadOnlyList<string> PreviousFronts, StudyClaim? Claim)
    {
        public object Material => new
        {
            goal = Goal,
            depth = Depth,
            objectiveId = ObjectiveId,
            sources = new[] { new { materialId = Source.MaterialId, sectionId = Source.SectionId, text = Source.Text, pageNumber = Source.PageNumber } },
            previousFronts = PreviousFronts,
            claim = Claim
        };
    }
    private sealed record StudyCardResult(JsonElement Proposal, IReadOnlyList<StudySourceReference> SourceReferences,
        IReadOnlyList<TutorConceptSuggestion> ConceptSuggestions)
    {
        public object ToWire() => new { proposal = Proposal, sourceReferences = SourceReferences, conceptSuggestions = ConceptSuggestions };
    }
    private sealed record PlanStudyInput(Guid? SessionId, Guid AreaId, string Fingerprint, IReadOnlyList<TutorHistoryEntry> History, JsonElement? Investigation,
        string Goal, string Depth, StudySource Source)
    {
        public object Material => new
        {
            goal = Goal,
            depth = Depth,
            sources = new[] { new { materialId = Source.MaterialId, sectionId = Source.SectionId, text = Source.Text, pageNumber = Source.PageNumber } }
        };
    }
    private sealed record StudyPlanClaim(string Title, string Description, string Priority, IReadOnlyList<StudySourceReference> SourceReferences);
    private sealed record PlanStudyResult(IReadOnlyList<StudyPlanClaim> Claims);
    private sealed record InspectionInput(Guid? SessionId, Guid AreaId, string Fingerprint, IReadOnlyList<TutorHistoryEntry> History, JsonElement? Investigation, string? ObjectiveId, object Inspection);
    private sealed record InspectionFinding(string Kind, string Severity, string Explanation, string Suggestion);
    private sealed record InspectionResult(IReadOnlyList<InspectionFinding> Findings, string Summary);
    private sealed record RefinementInput(Guid? SessionId, Guid AreaId, string Fingerprint, IReadOnlyList<TutorHistoryEntry> History, JsonElement? Investigation, string? ObjectiveId,
        object Refinement, string Mode, IReadOnlyList<StudySource> Sources);
    private sealed record QuizResult(string ObjectiveId, string ObjectiveTitle, IReadOnlyList<QuizQuestion> Questions)
    {
        public object ToWire() => new { objectiveId = ObjectiveId, objectiveTitle = ObjectiveTitle, questions = Questions };
        public object ToSessionWire() => new
        {
            objectiveId = ObjectiveId,
            objectiveTitle = ObjectiveTitle,
            questions = Questions.Select(question => new { question.Prompt, question.ExpectedAnswer, learnerAnswer = (string?)null, evaluation = (object?)null })
        };
    }
}
