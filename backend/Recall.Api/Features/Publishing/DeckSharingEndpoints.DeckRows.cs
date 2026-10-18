using System.Text.Json;

namespace Recall.Api.Features.Publishing;

public static partial class PublishingEndpoints
{
    private sealed record DeckSummary(string Id, string Title, string Description, string Language,
        string[] Tags, string AuthorName, string Visibility, string Status, string LatestVersionId,
        int Version, int CardCount, string UpdatedAt, string? License, string? Attribution, CatalogMetadata? Catalog);
    private sealed record CatalogPreview(string Kind, string Prompt, string? Answer);
    private sealed record CatalogMetadata(string? Difficulty, string[] CardTypes, string[] ActivityTypes,
        int EstimatedMinutes, CatalogPreview[] Preview);

    private static bool TryDeckRows(JsonElement value, out DeckData[] rows, bool allowMissingOwner = false)
    {
        rows = [];
        if (value.ValueKind != JsonValueKind.Array) return false;
        var result = new List<DeckData>();
        foreach (var item in value.EnumerateArray()) { if (!TryDeckRow(item, out var row, allowMissingOwner)) return false; result.Add(row); }
        rows = result.ToArray(); return true;
    }

    private sealed record DeckData(Guid Id, Guid OwnerId, string Title, string Description, string Language, string[] Tags,
        string AuthorName, string Visibility, string Status, Guid LatestVersionId, int Version, int CardCount,
        string UpdatedAt, string? License, string? Attribution, CatalogMetadata? Catalog);

    private static bool TryDeckRow(JsonElement row, out DeckData deck, bool allowMissingOwner = false)
    {
        deck = null!;
        var hasOwner = TryGuid(row, "owner_id", out var owner);
        if (!TryGuid(row, "deck_id", out var id) || (!hasOwner && !allowMissingOwner) ||
            !TryString(row, "title", out var title) || title.Length is < 1 or > 300 ||
            !TryStringAllowEmpty(row, "description", out var description) || description.Length > 4000 ||
            !TryStringAllowEmpty(row, "language", out var language) || language.Length > 40 ||
            !row.TryGetProperty("tags", out var tagValue) || tagValue.ValueKind != JsonValueKind.Array || tagValue.GetArrayLength() > 30 ||
            !TryStringAllowEmpty(row, "author_name", out var author) || author.Length > 120 ||
            !TryString(row, "visibility", out var visibility) || visibility is not ("private" or "unlisted" or "public") ||
            !TryString(row, "status", out var status) || status is not ("active" or "withdrawn" or "hidden") ||
            !TryGuid(row, "latest_version_id", out var latest) ||
            !row.TryGetProperty("version", out var ver) || !ver.TryGetInt32(out var version) || version <= 0 ||
            !row.TryGetProperty("card_count", out var count) || !count.TryGetInt32(out var cardCount) || cardCount < 0 ||
            !TryString(row, "updated_at", out var updated) || !DateTimeOffset.TryParse(updated, out _) ||
            !TryNullableString(row, "license", 120, out var license) || !TryNullableString(row, "attribution", 500, out var attribution) ||
            !TryCatalogMetadata(row, out var catalog)) return false;
        var tags = new List<string>();
        foreach (var item in tagValue.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: <= 80 } text) return false;
            tags.Add(text);
        }
        deck = new DeckData(id, hasOwner ? owner : Guid.Empty, title, description, language, tags.ToArray(), author, visibility, status, latest, version, cardCount, updated, license, attribution, catalog);
        return true;
    }

    private static bool TryCatalogMetadata(JsonElement row, out CatalogMetadata? catalog)
    {
        catalog = null;
        var names = new[] { "difficulty", "card_types", "activity_types", "estimated_minutes", "preview" };
        var present = names.Count(name => row.TryGetProperty(name, out _));
        if (present == 0) return true;
        if (present != names.Length || !TryNullableString(row, "difficulty", 20, out var difficulty) ||
            (difficulty is not null && difficulty is not ("beginner" or "intermediate" or "advanced")) ||
            !TryStringArray(row, "card_types", 2, out var cardTypes) ||
            cardTypes.Any(value => value is not ("basic" or "cloze")) ||
            !TryStringArray(row, "activity_types", 500, out var activityTypes) || activityTypes.Any(value => value.Length > 200) ||
            !row.TryGetProperty("estimated_minutes", out var minutesNode) || minutesNode.ValueKind != JsonValueKind.Number || !minutesNode.TryGetInt32(out var minutes) || minutes is < 1 or > 1000 ||
            !row.TryGetProperty("preview", out var previewNode) || previewNode.ValueKind != JsonValueKind.Array || previewNode.GetArrayLength() > 3)
            return false;
        var preview = new List<CatalogPreview>();
        foreach (var item in previewNode.EnumerateArray())
        {
            if (!TryString(item, "kind", out var kind) || kind is not ("basic" or "cloze" or "activity") ||
                !TryStringAllowEmpty(item, "prompt", out var prompt) || prompt.Length > 240 ||
                !TryNullableString(item, "answer", 240, out var answer)) return false;
            preview.Add(new CatalogPreview(kind, prompt, answer));
        }
        catalog = new CatalogMetadata(difficulty, cardTypes, activityTypes, minutes, preview.ToArray());
        return true;
    }

    private static bool TryStringArray(JsonElement row, string name, int maxItems, out string[] values)
    {
        values = [];
        if (!row.TryGetProperty(name, out var array) || array.ValueKind != JsonValueKind.Array || array.GetArrayLength() > maxItems) return false;
        var result = new List<string>();
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: > 0 } text) return false;
            result.Add(text);
        }
        values = result.ToArray();
        return true;
    }

    private static bool TryVersionRows(JsonElement value, out object[] rows)
    {
        rows = [];
        if (value.ValueKind != JsonValueKind.Array) return false;
        var result = new List<object>();
        foreach (var row in value.EnumerateArray())
        {
            if (!TryGuid(row, "id", out var id) || !row.TryGetProperty("version", out var versionNode) || !versionNode.TryGetInt32(out var version) || version <= 0 || !TryString(row, "created_at", out var created) || !DateTimeOffset.TryParse(created, out _)) return false;
            result.Add(new { id = id.ToString("D").ToLowerInvariant(), version, createdAt = created });
        }
        rows = result.ToArray(); return true;
    }

    private static DeckSummary DeckToSummary(DeckData value) => new(value.Id.ToString("D").ToLowerInvariant(), value.Title, value.Description, value.Language, value.Tags, value.AuthorName, value.Visibility, value.Status, value.LatestVersionId.ToString("D").ToLowerInvariant(), value.Version, value.CardCount, value.UpdatedAt, value.License, value.Attribution, value.Catalog);

    private static bool TryStringAllowEmpty(JsonElement row, string name, out string value)
    {
        value = string.Empty;
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) return false;
        value = property.GetString() ?? string.Empty; return true;
    }

}
