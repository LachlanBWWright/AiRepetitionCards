using System.Text.Json;
using System.Text.RegularExpressions;

namespace Recall.Api.Contracts;

public static partial class AuthoredMetadataValidator
{
    private static bool FieldName(JsonElement value) => Text(value, 1, 80) && Regex.IsMatch(value.GetString()!, "^[A-Za-z][A-Za-z0-9 _-]{0,79}$", RegexOptions.CultureInvariant);
    private static bool ValidLibrary(JsonElement library)
    {
        if (library.ValueKind != JsonValueKind.Object || !Array(library, "types", 0, 100, out var types) || !Array(library, "notes", 0, 50_000, out var notes)) return false;
        var typeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var type in types.EnumerateArray())
            if (!ValidType(type) || !typeIds.Add(type.GetProperty("id").GetString()!)) return false;
        var noteIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var note in notes.EnumerateArray())
        {
            if (note.ValueKind != JsonValueKind.Object || !RequiredText(note, "id", 1, 200) || !noteIds.Add(note.GetProperty("id").GetString()!) || !RequiredText(note, "typeId", 1, 200) || !typeIds.Contains(note.GetProperty("typeId").GetString()!) || !note.TryGetProperty("fields", out var fields) || fields.ValueKind != JsonValueKind.Object || !Array(note, "tags", 0, 100, out var tags) || !tags.EnumerateArray().All(tag => Text(tag, 1, 80)) || !Array(note, "objectiveIds", 0, int.MaxValue, out var objectives) || !objectives.EnumerateArray().All(value => Text(value, 1)) || !ValidOptionalMedia(note)) return false;
            if (note.TryGetProperty("source", out var source) && (source.ValueKind != JsonValueKind.Object || !RequiredText(source, "areaId", 1) || !RequiredText(source, "noteId", 1, 200) || !RequiredText(source, "revision", 64, 64) || !Regex.IsMatch(source.GetProperty("revision").GetString()!, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant))) return false;
            foreach (var field in fields.EnumerateObject())
                if (!Regex.IsMatch(field.Name, "^[A-Za-z][A-Za-z0-9 _-]{0,79}$", RegexOptions.CultureInvariant) || !Text(field.Value, 0, 20_000)) return false;
        }
        return true;
    }
    private static bool ValidType(JsonElement type)
    {
        if (type.ValueKind != JsonValueKind.Object || !RequiredText(type, "id", 1, 200) || !RequiredText(type, "name", 1, 80) || !Array(type, "fields", 1, 50, out var fields) || !Array(type, "templates", 1, 20, out var templates)) return false;
        var fieldNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in fields.EnumerateArray())
            if (field.ValueKind != JsonValueKind.Object || !field.TryGetProperty("name", out var name) || !FieldName(name) || !fieldNames.Add(name.GetString()!) || (field.TryGetProperty("sticky", out _) && !Boolean(field, "sticky"))) return false;
        var templateIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var template in templates.EnumerateArray())
            if (template.ValueKind != JsonValueKind.Object || !RequiredText(template, "id", 1, 200) || !templateIds.Add(template.GetProperty("id").GetString()!) || !RequiredText(template, "name", 1, 80) || !RequiredText(template, "front", 0, 20_000) || !RequiredText(template, "back", 0, 20_000) || (template.TryGetProperty("clozeField", out var source) && !FieldName(source)) || !OptionalText(template, "deckAreaId", 1) || (template.TryGetProperty("presentation", out var settings) && !ValidPresentation(settings))) return false;
        return true;
    }
    private static bool ValidOptionalMedia(JsonElement note)
    {
        if (!note.TryGetProperty("media", out var media)) return true;
        if (media.ValueKind != JsonValueKind.Array || media.GetArrayLength() > 20) return false;
        foreach (var item in media.EnumerateArray())
            if (item.ValueKind != JsonValueKind.Object || !RequiredText(item, "id", 64, 64) || !Regex.IsMatch(item.GetProperty("id").GetString()!, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant) || !RequiredText(item, "mimeType") || item.GetProperty("mimeType").GetString() is not ("image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav" or "audio/mp4" or "audio/webm") || !item.TryGetProperty("byteLength", out var length) || length.ValueKind != JsonValueKind.Number || !length.TryGetInt32(out var count) || count is < 1 or > 20_000_000) return false;
        return true;
    }
}
