using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Recall.Api.Features.Publishing;

public static partial class PublishingEndpoints
{
    private static readonly JsonSerializerOptions CanonicalJsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private sealed record Publication(int Version, JsonElement Content, string ContentHash,
        string? Attribution, string? License, string? ForkedFromVersionId, string CreatedAt, string ReleaseNotes = "");

    private static bool TryValidatePublication(JsonElement row, Guid? expectedId, out Publication publication)
    {
        publication = null!;
        if (!TryGuid(row, "id", out var id) || (expectedId.HasValue && id != expectedId.Value) ||
            !row.TryGetProperty("version", out var versionElement) || !versionElement.TryGetInt32(out var version) || version <= 0 ||
            !row.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object ||
            !TryString(row, "content_hash", out var contentHash) || contentHash.Length != 64 || !contentHash.All(Uri.IsHexDigit) ||
            !TryString(row, "created_at", out var createdAt) || !DateTimeOffset.TryParse(createdAt, out _) ||
            !content.TryGetProperty("id", out var contentId) || contentId.ValueKind != JsonValueKind.String ||
            !TryGuid(contentId.GetString() ?? string.Empty, out _)) return false;
        var normalizedContent = NormalizeKnowledgeArea(content);
        if (normalizedContent is null || !ValidPortableDocument(normalizedContent.Value)) return false;
        var actualHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(normalizedContent.Value)))).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actualHash), Encoding.ASCII.GetBytes(contentHash.ToLowerInvariant()))) return false;
        if (!TryNullableString(row, "attribution", 500, out var attribution) ||
            !TryNullableString(row, "license", 120, out var license) ||
            !row.TryGetProperty("forked_from_version_id", out var forkElement)) return false;
        string? forked = null;
        if (forkElement.ValueKind == JsonValueKind.String)
        {
            if (!TryGuid(forkElement.GetString() ?? string.Empty, out var forkId)) return false;
            forked = forkId.ToString("D").ToLowerInvariant();
        }
        else if (forkElement.ValueKind != JsonValueKind.Null) return false;
        var releaseNotes = row.TryGetProperty("release_notes", out var notes) && notes.ValueKind == JsonValueKind.String
            ? notes.GetString() ?? string.Empty : string.Empty;
        if (releaseNotes.Length > 4_000) return false;
        publication = new Publication(version, normalizedContent.Value, contentHash.ToLowerInvariant(), attribution, license, forked, createdAt, releaseNotes);
        return true;
    }

    private static JsonElement? NormalizeKnowledgeArea(JsonElement value)
    {
        try
        {
            if (value.ValueKind != JsonValueKind.Object) return null;
            var document = JsonNode.Parse(value.GetRawText())?.AsObject();
            if (document is null) return null;
            KeepOnly(document, "schemaVersion", "id", "sourceId", "title", "description", "language", "difficulty", "objectives", "ai", "cards", "tags", "licence", "attribution", "forkedFromVersionId", "activities", "noteLibrary");
            if (document["objectives"] is JsonArray objectives)
                foreach (var objective in objectives.OfType<JsonObject>())
                    KeepOnly(objective, "id", "title", "description", "prerequisiteIds", "sourceId");
            if (document["ai"] is JsonObject ai)
                KeepOnly(ai, "tutorInstructions", "quizInstructions", "cardGenerationInstructions");
            if (document["cards"] is JsonArray cards)
            {
                foreach (var card in cards.OfType<JsonObject>())
                {
                    if (card["kind"]?.GetValue<string>() == "basic")
                        KeepOnly(card, "kind", "id", "front", "back", "objectiveIds", "media", "tags", "origin", "sourceId", "noteId", "templateId", "presentation", "imageOcclusion");
                    else
                        KeepOnly(card, "kind", "id", "text", "deletionIndex", "objectiveIds", "media", "tags", "origin", "sourceId", "noteId", "templateId", "presentation", "imageOcclusion");
                    if (card["media"] is JsonArray media)
                        foreach (var reference in media.OfType<JsonObject>())
                            KeepOnly(reference, "id", "mimeType", "byteLength");
                }
            }
            if (document["activities"] is JsonArray activities)
                foreach (var activity in activities.OfType<JsonObject>())
                    KeepOnly(activity, "id", "sourceId", "areaId", "title", "pluginId", "pluginVersion", "revision", "objectiveIds", "fallback", "payload", "archived");
            Recall.Api.Contracts.AuthoredMetadataValidator.Normalize(document);
            using var normalized = JsonDocument.Parse(document.ToJsonString());
            return normalized.RootElement.Clone();
        }
        catch (JsonException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    private static string CanonicalJson(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Object => "{" + string.Join(',', value.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => JsonSerializer.Serialize(property.Name, CanonicalJsonOptions) + ":" + CanonicalJson(property.Value))) + "}",
        JsonValueKind.Array => "[" + string.Join(',', value.EnumerateArray().Select(CanonicalJson)) + "]",
        JsonValueKind.String => JsonSerializer.Serialize(value.GetString(), CanonicalJsonOptions),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => "null"
    };

    private static bool ValidPortableDocument(JsonElement content)
    {
        var wrapper = JsonSerializer.SerializeToElement(new
        {
            schemaVersion = 1,
            ownerId = "00000000-0000-4000-8000-000000000000",
            areas = new[] { new { document = content, color = "#5965d8", contentHash = new string('0', 64) } },
            deletedAreaIds = Array.Empty<string>()
        });
        return Recall.Api.Contracts.ContractBoundaryValidator.ValidateWorkspaceSnapshot(wrapper).IsValid;
    }

    private static bool TryString(JsonElement row, string name, out string value)
    {
        value = string.Empty;
        return row.ValueKind == JsonValueKind.Object && row.TryGetProperty(name, out var property) &&
               property.ValueKind == JsonValueKind.String && (value = property.GetString() ?? string.Empty).Length > 0;
    }

    private static string? OptionalString(JsonElement row, string name) =>
        row.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String ? property.GetString() : null;

    private static bool TryNullableString(JsonElement row, string name, int maximumLength, out string? value)
    {
        value = null;
        if (!row.TryGetProperty(name, out var property)) return false;
        if (property.ValueKind == JsonValueKind.Null) return true;
        if (property.ValueKind != JsonValueKind.String) return false;
        value = property.GetString();
        return value is not null && value.Length <= maximumLength;
    }

    private static bool OptionalNullableString(JsonElement row, string name, int maximumLength)
    {
        if (!row.TryGetProperty(name, out var property)) return true;
        if (property.ValueKind == JsonValueKind.Null) return true;
        return property.ValueKind == JsonValueKind.String && property.GetString() is { Length: var length } && length <= maximumLength;
    }

    private static bool TryGuid(JsonElement row, string name, out Guid value)
    {
        value = Guid.Empty;
        return row.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String &&
               TryGuid(property.GetString() ?? string.Empty, out value);
    }
}
