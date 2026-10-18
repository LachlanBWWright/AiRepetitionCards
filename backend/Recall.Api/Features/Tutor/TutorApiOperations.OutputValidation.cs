using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private static bool TryValidateRefinement(JsonElement output, RefinementInput input, out JsonElement result)
    {
        result = default;
        if (output.ValueKind != JsonValueKind.Object || !output.TryGetProperty("cards", out var cards) || cards.ValueKind != JsonValueKind.Array || cards.GetArrayLength() is < 1 or > 5)
            return false;
        foreach (var card in cards.EnumerateArray())
        {
            if (!IsProposalContent(card) || !TryNullableString(card, "objectiveId", out var objectiveId) || objectiveId != input.ObjectiveId ||
                !card.TryGetProperty("meaningChanged", out var changed) || changed.ValueKind is not (JsonValueKind.True or JsonValueKind.False) ||
                !card.TryGetProperty("sourceReferences", out var references) || references.ValueKind != JsonValueKind.Array || references.GetArrayLength() > 4 ||
                input.Sources.Count > 0 && references.GetArrayLength() == 0 ||
                input.Mode == "cloze" && !System.Text.RegularExpressions.Regex.IsMatch(card.GetProperty("front").GetString() ?? string.Empty, "\\{\\{c[1-9]\\d*::[^{}]+\\}\\}"))
                return false;
            foreach (var sourceReference in references.EnumerateArray())
                if (!MatchesSourceReference(sourceReference, input.Sources)) return false;
        }
        var canonicalCards = cards.EnumerateArray().Select(card =>
        {
            var references = card.GetProperty("sourceReferences").EnumerateArray().Select(reference => new
            {
                materialId = reference.GetProperty("materialId").GetString(),
                sectionId = reference.GetProperty("sectionId").GetString(),
                quote = reference.GetProperty("quote").GetString(),
                pageNumber = reference.GetProperty("pageNumber").ValueKind == JsonValueKind.Null
                    ? (int?)null
                    : reference.GetProperty("pageNumber").GetInt32()
            }).ToArray();
            return new
            {
                front = card.GetProperty("front").GetString(),
                back = card.GetProperty("back").GetString(),
                objectiveId = input.ObjectiveId,
                rationale = card.GetProperty("rationale").GetString(),
                meaningChanged = card.GetProperty("meaningChanged").GetBoolean(),
                sourceReferences = references
            };
        }).ToArray();
        result = JsonSerializer.SerializeToElement(new { cards = canonicalCards }, JsonOptions);
        return true;
    }

    private static bool MatchesSourceReference(JsonElement reference, IReadOnlyList<StudySource> sources)
    {
        if (!TryString(reference, "materialId", out var materialText) || !TryUuid(materialText, out var materialId) ||
            !TryString(reference, "sectionId", out var sectionText) || !TryUuid(sectionText, out var sectionId) ||
            !TryString(reference, "quote", out var quote) || !TryNullablePositiveInt(reference, "pageNumber", out var page)) return false;
        return sources.Any(source => source.MaterialId == materialId && source.SectionId == sectionId && source.PageNumber == page &&
            source.Text.Contains(quote, StringComparison.Ordinal));
    }

    private static bool TryStudySources(JsonElement parent, out IReadOnlyList<StudySource> sources)
    {
        sources = [];
        if (!parent.TryGetProperty("sources", out var values) || values.ValueKind != JsonValueKind.Array || values.GetArrayLength() > 1) return false;
        var result = new List<StudySource>();
        foreach (var source in values.EnumerateArray())
        {
            if (!TryString(source, "materialId", out var materialText) || !TryUuid(materialText, out var materialId) ||
                !TryString(source, "sectionId", out var sectionText) || !TryUuid(sectionText, out var sectionId) ||
                !TryString(source, "text", out var text) || text.Length > 12_000 || !TryNullablePositiveInt(source, "pageNumber", out var page)) return false;
            result.Add(new StudySource(materialId, sectionId, text, page));
        }
        sources = result;
        return true;
    }

    private static JsonElement CreateInspectionSchema() => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new
        {
            findings = new
            {
                type = "array",
                maxItems = 12,
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        kind = new { type = "string", @enum = new[] { "ambiguity", "multiple-facts", "answer-leakage", "missing-context", "unsupported-claim", "other" } },
                        severity = new { type = "string", @enum = new[] { "warning", "suggestion" } },
                        explanation = new { type = "string", minLength = 1, maxLength = 1_000 },
                        suggestion = new { type = "string", minLength = 1, maxLength = 1_000 }
                    },
                    required = new[] { "kind", "severity", "explanation", "suggestion" }
                }
            },
            summary = new { type = "string", minLength = 1, maxLength = 2_000 }
        },
        required = new[] { "findings", "summary" }
    }, JsonOptions);

    private static bool TryValidateInspection(JsonElement output, out InspectionResult result)
    {
        result = default!;
        if (output.ValueKind != JsonValueKind.Object || !TryString(output, "summary", out var summary) || summary.Length > 2_000 ||
            !output.TryGetProperty("findings", out var findings) || findings.ValueKind != JsonValueKind.Array || findings.GetArrayLength() > 12) return false;
        var parsed = new List<InspectionFinding>();
        foreach (var finding in findings.EnumerateArray())
        {
            if (!TryString(finding, "kind", out var kind) || kind is not ("ambiguity" or "multiple-facts" or "answer-leakage" or "missing-context" or "unsupported-claim" or "other") ||
                !TryString(finding, "severity", out var severity) || severity is not ("warning" or "suggestion") ||
                !TryString(finding, "explanation", out var explanation) || explanation.Length > 1_000 ||
                !TryString(finding, "suggestion", out var suggestion) || suggestion.Length > 1_000) return false;
            parsed.Add(new InspectionFinding(kind, severity, explanation, suggestion));
        }
        result = new InspectionResult(parsed, summary);
        return true;
    }

    private static JsonElement CreatePlanStudySchema() => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new
        {
            claims = new
            {
                type = "array",
                minItems = 1,
                maxItems = 20,
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        title = new { type = "string", minLength = 1, maxLength = 200 },
                        description = new { type = "string", minLength = 1, maxLength = 2_000 },
                        priority = new { type = "string", @enum = new[] { "high", "medium", "low" } },
                        sourceReferences = new
                        {
                            type = "array",
                            minItems = 1,
                            maxItems = 4,
                            items = new
                            {
                                type = "object",
                                additionalProperties = false,
                                properties = new { materialId = new { type = "string" }, sectionId = new { type = "string" }, quote = new { type = "string", minLength = 1, maxLength = 2_000 }, pageNumber = new { type = new[] { "integer", "null" } } },
                                required = new[] { "materialId", "sectionId", "quote", "pageNumber" }
                            }
                        }
                    },
                    required = new[] { "title", "description", "priority", "sourceReferences" }
                }
            }
        },
        required = new[] { "claims" }
    }, JsonOptions);

    private static bool TryValidatePlanStudy(JsonElement output, StudySource source, out PlanStudyResult result)
    {
        result = default!;
        if (output.ValueKind != JsonValueKind.Object || !output.TryGetProperty("claims", out var claims) || claims.ValueKind != JsonValueKind.Array || claims.GetArrayLength() is < 1 or > 20)
            return false;
        var parsedClaims = new List<StudyPlanClaim>();
        foreach (var claim in claims.EnumerateArray())
        {
            if (!TryString(claim, "title", out var title) || title.Length > 200 || !TryString(claim, "description", out var description) || description.Length > 2_000 ||
                !TryString(claim, "priority", out var priority) || priority is not ("high" or "medium" or "low") ||
                !claim.TryGetProperty("sourceReferences", out var refs) || refs.ValueKind != JsonValueKind.Array || refs.GetArrayLength() is < 1 or > 4) return false;
            var references = new List<StudySourceReference>();
            foreach (var reference in refs.EnumerateArray())
            {
                if (!TryString(reference, "materialId", out var materialText) || !TryUuid(materialText, out var materialId) ||
                    !TryString(reference, "sectionId", out var sectionText) || !TryUuid(sectionText, out var sectionId) ||
                    !TryString(reference, "quote", out var quote) || quote.Length > 2_000 || !TryNullablePositiveInt(reference, "pageNumber", out var page) ||
                    materialId != source.MaterialId || sectionId != source.SectionId || page != source.PageNumber || !source.Text.Contains(quote, StringComparison.Ordinal)) return false;
                references.Add(new StudySourceReference(materialId, sectionId, quote, page));
            }
            parsedClaims.Add(new StudyPlanClaim(title, description, priority, references));
        }
        result = new PlanStudyResult(parsedClaims);
        return true;
    }

    private static JsonElement CreateStudyCardSchema(string? objectiveId) => JsonSerializer.SerializeToElement(new
    {
        type = "object",
        additionalProperties = false,
        properties = new Dictionary<string, object>
        {
            ["proposal"] = new
            {
                type = "object",
                additionalProperties = false,
                properties = new
                {
                    front = new { type = "string", minLength = 1, maxLength = 1_000 },
                    back = new { type = "string", minLength = 1, maxLength = 3_000 },
                    objectiveId = new { @enum = new object?[] { objectiveId } },
                    rationale = new { type = "string", minLength = 1, maxLength = 1_000 }
                },
                required = new[] { "front", "back", "objectiveId", "rationale" }
            },
            ["sourceReferences"] = new
            {
                type = "array",
                minItems = 1,
                maxItems = 4,
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new { materialId = new { type = "string" }, sectionId = new { type = "string" }, quote = new { type = "string", minLength = 1, maxLength = 2_000 }, pageNumber = new { type = new[] { "integer", "null" } } },
                    required = new[] { "materialId", "sectionId", "quote", "pageNumber" }
                }
            },
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
        required = new[] { "proposal", "sourceReferences", "conceptSuggestions" }
    }, JsonOptions);

    private static bool TryValidateStudyCard(JsonElement output, StudyCardInput input, out StudyCardResult result)
    {
        result = default!;
        if (output.ValueKind != JsonValueKind.Object || !output.TryGetProperty("proposal", out var proposal) ||
            !IsProposalContent(proposal) || !TryNullableString(proposal, "objectiveId", out var returnedObjective) || returnedObjective != input.ObjectiveId ||
            !output.TryGetProperty("sourceReferences", out var refs) || refs.ValueKind != JsonValueKind.Array || refs.GetArrayLength() is < 1 or > 4 ||
            !output.TryGetProperty("conceptSuggestions", out var suggestions) || suggestions.ValueKind != JsonValueKind.Array || suggestions.GetArrayLength() > 8)
            return false;
        var references = new List<StudySourceReference>();
        foreach (var reference in refs.EnumerateArray())
        {
            if (!TryString(reference, "materialId", out var materialIdText) || !TryUuid(materialIdText, out var materialId) ||
                !TryString(reference, "sectionId", out var sectionIdText) || !TryUuid(sectionIdText, out var sectionId) ||
                !TryString(reference, "quote", out var quote) || quote.Length > 2_000 || !TryNullablePositiveInt(reference, "pageNumber", out var pageNumber) ||
                materialId != input.Source.MaterialId || sectionId != input.Source.SectionId || pageNumber != input.Source.PageNumber ||
                !input.Source.Text.Contains(quote, StringComparison.Ordinal)) return false;
            references.Add(new StudySourceReference(materialId, sectionId, quote, pageNumber));
        }
        var concepts = new List<TutorConceptSuggestion>();
        foreach (var item in suggestions.EnumerateArray())
        {
            if (!TryString(item, "title", out var title) || title.Length > 200 || !TryString(item, "description", out var description) || description.Length > 1_000)
                return false;
            concepts.Add(new TutorConceptSuggestion(title, description));
        }
        if (!TryNormalizeProposalContent(proposal, out var canonicalProposal)) return false;
        result = new StudyCardResult(canonicalProposal, references, concepts);
        return true;
    }
}
