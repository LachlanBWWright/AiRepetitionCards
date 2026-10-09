using System.Text.Json;
using System.Text.RegularExpressions;

namespace Recall.Api.Contracts;

/// <summary>
/// Validates the successful response contracts shared with @recall/contracts.
/// JsonElement remains untrusted until a validator returns success.
/// </summary>
public static partial class ContractBoundaryValidator
{
    private static readonly Regex Uuid = UuidPattern();
    private static readonly Regex Hash = HashPattern();
    private static readonly Regex MediaId = MediaIdPattern();
    private static readonly Regex Color = ColorPattern();

    /// <summary>Routes the checked-in dotnet-v1 fixture names to their response schema.</summary>
    public static ContractValidationResult ValidateDotnetV1Fixture(string fileName, JsonElement value) => fileName switch
    {
        "auth-session-anonymous.json" or "auth-session-authenticated.json" => ValidateAuthSession(value),
        "workspace-empty.json" or "workspace-populated.json" => ValidateWorkspaceSnapshot(value),
        _ => ContractValidationResult.Invalid("unknown-dotnet-fixture")
    };

    public static ContractValidationResult ValidateAuthSession(JsonElement value)
    {
        if (!IsObject(value) || !HasOnly(value, "schemaVersion", "authenticated", "displayLabel", "ownerId") ||
            !IsSchemaVersionOne(value) ||
            !Has(value, "authenticated", JsonValueKind.True, JsonValueKind.False))
        {
            return ContractValidationResult.Invalid("invalid-auth-session-shape");
        }

        var authenticated = value.GetProperty("authenticated").GetBoolean();
        var displayLabel = value.GetProperty("displayLabel");
        var ownerId = value.GetProperty("ownerId");
        if (!authenticated)
        {
            return displayLabel.ValueKind == JsonValueKind.Null && ownerId.ValueKind == JsonValueKind.Null
                ? ContractValidationResult.Valid
                : ContractValidationResult.Invalid("invalid-anonymous-session");
        }

        return displayLabel.ValueKind == JsonValueKind.String &&
               displayLabel.GetString() is { Length: > 0 and <= 320 } &&
               ownerId.ValueKind == JsonValueKind.String && IsUuid(ownerId.GetString())
            ? ContractValidationResult.Valid
            : ContractValidationResult.Invalid("invalid-authenticated-session");
    }

    public static ContractValidationResult ValidateWorkspaceSnapshot(JsonElement value)
    {
        if (!IsObject(value) || !HasOnly(value, "schemaVersion", "ownerId", "areas", "deletedAreaIds") ||
            !IsSchemaVersionOne(value) ||
            !Has(value, "ownerId", JsonValueKind.String) || !IsUuid(value.GetProperty("ownerId").GetString()) ||
            !Has(value, "areas", JsonValueKind.Array) || !Has(value, "deletedAreaIds", JsonValueKind.Array))
        {
            return ContractValidationResult.Invalid("invalid-workspace-shape");
        }

        foreach (var deletedId in value.GetProperty("deletedAreaIds").EnumerateArray())
        {
            if (!IsNonEmptyString(deletedId))
                return ContractValidationResult.Invalid("invalid-deleted-area-id");
        }

        foreach (var area in value.GetProperty("areas").EnumerateArray())
        {
            var result = ValidateWorkspaceArea(area);
            if (!result.IsValid) return result;
        }

        return ContractValidationResult.Valid;
    }

    private static ContractValidationResult ValidateWorkspaceArea(JsonElement area)
    {
        if (!IsObject(area) || !HasOnly(area, "document", "color", "contentHash") ||
            !Has(area, "document", JsonValueKind.Object) || !Has(area, "color", JsonValueKind.String) ||
            !Color.IsMatch(area.GetProperty("color").GetString() ?? "") ||
            !Has(area, "contentHash", JsonValueKind.String) ||
            !Hash.IsMatch(area.GetProperty("contentHash").GetString() ?? ""))
            return ContractValidationResult.Invalid("invalid-workspace-area");

        var document = area.GetProperty("document");
        if (!IsObject(document) || !Has(document, "schemaVersion", JsonValueKind.String) ||
            document.GetProperty("schemaVersion").GetString() != "1.0.0" ||
            !Has(document, "id", JsonValueKind.String) || !IsNonEmptyString(document.GetProperty("id")) ||
            !OptionalString(document, "sourceId") ||
            !Has(document, "title", JsonValueKind.String) || document.GetProperty("title").GetString() is not { Length: > 0 and <= 80 } ||
            !Has(document, "description", JsonValueKind.Null, JsonValueKind.String) ||
            !Has(document, "language", JsonValueKind.String) || string.IsNullOrEmpty(document.GetProperty("language").GetString()) ||
            !Has(document, "objectives", JsonValueKind.Array) ||
            !Has(document, "ai", JsonValueKind.Object) ||
            !Has(document, "cards", JsonValueKind.Array) || document.GetProperty("cards").GetArrayLength() > 500 ||
            !Has(document, "tags", JsonValueKind.Array) || !AllStrings(document.GetProperty("tags")) ||
            !Has(document, "licence", JsonValueKind.Null, JsonValueKind.String) ||
            !OptionalNullableString(document, "attribution", 500) ||
            !OptionalString(document, "forkedFromVersionId", 80))
            return ContractValidationResult.Invalid("invalid-knowledge-area");

        var objectives = document.GetProperty("objectives");
        if (objectives.GetArrayLength() > 200 || !ValidObjectives(objectives, out var objectiveIds))
            return ContractValidationResult.Invalid("invalid-knowledge-area-objectives");

        var ai = document.GetProperty("ai");
        if (!HasOnly(ai, "tutorInstructions", "quizInstructions", "cardGenerationInstructions") ||
            !Has(ai, "tutorInstructions", JsonValueKind.String) ||
            (ai.GetProperty("tutorInstructions").GetString()?.Length ?? 0) > 2_000 ||
            !Has(ai, "quizInstructions", JsonValueKind.Null, JsonValueKind.String) ||
            StringLength(ai.GetProperty("quizInstructions")) > 2_000 ||
            !Has(ai, "cardGenerationInstructions", JsonValueKind.Null, JsonValueKind.String) ||
            StringLength(ai.GetProperty("cardGenerationInstructions")) > 2_000)
            return ContractValidationResult.Invalid("invalid-knowledge-area-ai");

        foreach (var card in document.GetProperty("cards").EnumerateArray())
        {
            if (!IsObject(card) || !Has(card, "kind", JsonValueKind.String) ||
                card.GetProperty("kind").GetString() is not ("basic" or "cloze") ||
                !Has(card, "id", JsonValueKind.String) || !IsNonEmptyString(card.GetProperty("id")) ||
                !OptionalString(card, "sourceId") ||
                !Has(card, "objectiveIds", JsonValueKind.Array) || !AllNonEmptyStrings(card.GetProperty("objectiveIds")) ||
                !ArrayValuesIn(card.GetProperty("objectiveIds"), objectiveIds) ||
                !Has(card, "tags", JsonValueKind.Array) || !AllStrings(card.GetProperty("tags")) ||
                !OptionalMedia(card) ||
                !Has(card, "origin", JsonValueKind.String) ||
                card.GetProperty("origin").GetString() is not ("authored" or "imported" or "ai-generated"))
                return ContractValidationResult.Invalid("invalid-knowledge-area-card");

            var isBasic = card.GetProperty("kind").GetString() == "basic";
            if (isBasic ? !Has(card, "front", JsonValueKind.String) || string.IsNullOrEmpty(card.GetProperty("front").GetString()) ||
                          !Has(card, "back", JsonValueKind.String) || string.IsNullOrEmpty(card.GetProperty("back").GetString())
                        : !Has(card, "text", JsonValueKind.String) || card.GetProperty("text").GetString() is not { Length: > 0 and <= 20_000 } ||
                          (card.TryGetProperty("deletionIndex", out var index) &&
                           (index.ValueKind != JsonValueKind.Number || !index.TryGetInt32(out var n) || n is < 1 or > 20)))
                return ContractValidationResult.Invalid("invalid-knowledge-area-card-content");
        }

        return ContractValidationResult.Valid;
    }

    private static bool AllStrings(JsonElement array) => array.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String);
    private static bool AllNonEmptyStrings(JsonElement array) => array.EnumerateArray().All(IsNonEmptyString);
    private static bool IsNonEmptyString(JsonElement value) => value.ValueKind == JsonValueKind.String && !string.IsNullOrEmpty(value.GetString());
    private static bool OptionalString(JsonElement parent, string name, int? maxLength = null) =>
        !parent.TryGetProperty(name, out var value) || (value.ValueKind == JsonValueKind.String &&
            (maxLength is null || (value.GetString()?.Length ?? 0) <= maxLength));
    private static bool OptionalNullableString(JsonElement parent, string name, int? maxLength = null) =>
        !parent.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null ||
        (value.ValueKind == JsonValueKind.String && (maxLength is null || (value.GetString()?.Length ?? 0) <= maxLength));
    private static int StringLength(JsonElement value) => value.ValueKind == JsonValueKind.String ? value.GetString()?.Length ?? 0 : 0;
    private static bool OptionalMedia(JsonElement card) => !card.TryGetProperty("media", out var media) ||
        (media.ValueKind == JsonValueKind.Array && media.GetArrayLength() <= 20 && media.EnumerateArray().All(ValidMedia));
    private static bool ValidMedia(JsonElement media) => IsObject(media) &&
        Has(media, "id", JsonValueKind.String) && MediaId.IsMatch(media.GetProperty("id").GetString() ?? "") &&
        Has(media, "mimeType", JsonValueKind.String) && media.GetProperty("mimeType").GetString() is
            "image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav" &&
        Has(media, "byteLength", JsonValueKind.Number) && media.GetProperty("byteLength").TryGetInt32(out var length) &&
        length is > 0 and <= 20_000_000;
    private static bool ValidObjectives(JsonElement objectives, out HashSet<string> ids)
    {
        ids = new(StringComparer.Ordinal);
        foreach (var objective in objectives.EnumerateArray())
        {
            if (!IsObject(objective) || !Has(objective, "id", JsonValueKind.String) ||
                !IsNonEmptyString(objective.GetProperty("id")) || !Has(objective, "title", JsonValueKind.String) ||
                string.IsNullOrWhiteSpace(objective.GetProperty("title").GetString()) ||
                !Has(objective, "description", JsonValueKind.Null, JsonValueKind.String) ||
                !OptionalString(objective, "sourceId") || !Has(objective, "prerequisiteIds", JsonValueKind.Array) ||
                !AllNonEmptyStrings(objective.GetProperty("prerequisiteIds")) ||
                objective.GetProperty("prerequisiteIds").GetArrayLength() != objective.GetProperty("prerequisiteIds")
                    .EnumerateArray().Select(value => value.GetString()).Distinct(StringComparer.Ordinal).Count()) return false;
            if (!ids.Add(objective.GetProperty("id").GetString()!)) return false;
        }
        foreach (var objective in objectives.EnumerateArray())
        {
            var id = objective.GetProperty("id").GetString()!;
            foreach (var prerequisite in objective.GetProperty("prerequisiteIds").EnumerateArray())
            {
                var prerequisiteId = prerequisite.GetString()!;
                if (!ids.Contains(prerequisiteId) || prerequisiteId == id) return false;
            }
        }
        foreach (var objective in objectives.EnumerateArray())
        {
            var originId = objective.GetProperty("id").GetString()!;
            var pending = new Stack<string>(objective.GetProperty("prerequisiteIds").EnumerateArray()
                .Select(value => value.GetString()!));
            var visited = new HashSet<string>(StringComparer.Ordinal);
            while (pending.TryPop(out var prerequisiteId))
            {
                if (prerequisiteId == originId) return false;
                if (!visited.Add(prerequisiteId)) continue;
                var prerequisite = objectives.EnumerateArray()
                    .First(value => value.GetProperty("id").GetString() == prerequisiteId);
                foreach (var nested in prerequisite.GetProperty("prerequisiteIds").EnumerateArray())
                    pending.Push(nested.GetString()!);
            }
        }
        return true;
    }
    private static bool ArrayValuesIn(JsonElement array, HashSet<string> allowed) =>
        array.EnumerateArray().All(value => allowed.Contains(value.GetString()!));
    private static bool IsObject(JsonElement value) => value.ValueKind == JsonValueKind.Object;
    private static bool IsSchemaVersionOne(JsonElement value) => Has(value, "schemaVersion", JsonValueKind.Number) &&
        value.GetProperty("schemaVersion").TryGetInt32(out var version) && version == 1;
    private static bool IsUuid(string? value) => value is not null && Uuid.IsMatch(value);
    private static bool Has(JsonElement value, string name, params JsonValueKind[] kinds) =>
        value.TryGetProperty(name, out var property) && kinds.Contains(property.ValueKind);
    private static bool HasOnly(JsonElement value, params string[] names) =>
        value.EnumerateObject().All(property => names.Contains(property.Name, StringComparer.Ordinal));

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UuidPattern();
    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex HashPattern();
    [GeneratedRegex("^[a-f0-9]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex MediaIdPattern();
    [GeneratedRegex("^#[0-9a-f]{6}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ColorPattern();
}

public sealed record ContractValidationResult(bool IsValid, string? ErrorCode)
{
    public static ContractValidationResult Valid { get; } = new(true, null);
    public static ContractValidationResult Invalid(string errorCode) => new(false, errorCode);
}
