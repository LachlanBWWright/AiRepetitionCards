using System.Text.Json;
using System.Text.Json.Nodes;

namespace Recall.Api.Contracts;

/// <summary>Shared boundaries for portable authored metadata; never executes templates or markup.</summary>
public static partial class AuthoredMetadataValidator
{
    public static bool Validate(JsonElement document)
    {
        if (document.ValueKind != JsonValueKind.Object) return false;
        if (document.TryGetProperty("noteLibrary", out var library) && !ValidLibrary(library)) return false;
        if (!document.TryGetProperty("cards", out var cards) || cards.ValueKind != JsonValueKind.Array) return false;
        foreach (var card in cards.EnumerateArray())
        {
            if (card.ValueKind != JsonValueKind.Object || !OptionalText(card, "noteId") || !OptionalText(card, "templateId") ||
                (card.TryGetProperty("presentation", out var presentation) && !ValidPresentation(presentation)) ||
                (card.TryGetProperty("imageOcclusion", out var occlusion) && !ValidOcclusion(occlusion))) return false;
        }
        return true;
    }

    private static bool Text(JsonElement value, int min = 0, int max = int.MaxValue) => value.ValueKind == JsonValueKind.String && value.GetString() is { } text && text.Length >= min && text.Length <= max;
    private static bool OptionalText(JsonElement parent, string key, int min = 0, int max = int.MaxValue) => !parent.TryGetProperty(key, out var value) || Text(value, min, max);
    private static bool RequiredText(JsonElement parent, string key, int min = 0, int max = int.MaxValue) => parent.TryGetProperty(key, out var value) && Text(value, min, max);
    private static bool Boolean(JsonElement parent, string key) => parent.TryGetProperty(key, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False;
    private static bool Array(JsonElement parent, string key, int min, int max, out JsonElement result) => parent.TryGetProperty(key, out result) && result.ValueKind == JsonValueKind.Array && result.GetArrayLength() >= min && result.GetArrayLength() <= max;
    private static bool Number(JsonElement parent, string key, double min, double max) => parent.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) && number >= min && number <= max;
    private static bool UniqueStrings(JsonElement array) => array.EnumerateArray().All(value => Text(value)) && array.EnumerateArray().Select(value => value.GetString()).Distinct(StringComparer.Ordinal).Count() == array.GetArrayLength();
    private static bool ValidPresentation(JsonElement presentation)
    {
        if (presentation.ValueKind != JsonValueKind.Object) return false;
        if (presentation.TryGetProperty("appearance", out var appearance) && !ValidAppearance(appearance)) return false;
        if (presentation.TryGetProperty("typedAnswer", out var answer) && (answer.ValueKind != JsonValueKind.Object || !Boolean(answer, "enabled") || !Boolean(answer, "ignoreCase") || !Boolean(answer, "ignoreAccents"))) return false;
        if (!presentation.TryGetProperty("speech", out var speech)) return true;
        if (speech.ValueKind != JsonValueKind.Object) return false;
        foreach (var field in new[] { "front", "back" })
            if (speech.TryGetProperty(field, out var settings) && (settings.ValueKind != JsonValueKind.Object || !RequiredText(settings, "language", 1, 80) || !OptionalText(settings, "voice", 0, 200) || !Number(settings, "rate", .25, 2) || !Boolean(settings, "autoplay"))) return false;
        return true;
    }
    private static bool Choice(JsonElement parent, string key, params string[] values) => parent.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && values.Contains(value.GetString(), StringComparer.Ordinal);
    private static bool ValidAppearance(JsonElement value) => value.ValueKind == JsonValueKind.Object && Choice(value, "font", "sans", "serif", "mono") && Choice(value, "size", "small", "medium", "large") && Choice(value, "align", "left", "center") && Choice(value, "lineSpacing", "compact", "comfortable");

    public static void Normalize(JsonObject document, bool preservePrivate = false)
    {
        if (document["noteLibrary"] is JsonObject library)
        {
            Keep(library, "types", "notes");
            if (library["types"] is JsonArray types)
                foreach (var type in types.OfType<JsonObject>()) NormalizeType(type, preservePrivate);
            if (library["notes"] is JsonArray notes)
                foreach (var note in notes.OfType<JsonObject>())
                {
                    if (preservePrivate) Keep(note, "id", "typeId", "fields", "tags", "objectiveIds", "media", "source");
                    else Keep(note, "id", "typeId", "fields", "tags", "objectiveIds", "media");
                    if (note["source"] is JsonObject source) Keep(source, "areaId", "noteId", "revision");
                    NormalizeMedia(note);
                }
        }
        if (document["cards"] is not JsonArray cards) return;
        foreach (var card in cards.OfType<JsonObject>())
        {
            if (card["presentation"] is JsonObject presentation) NormalizePresentation(presentation);
            if (card["imageOcclusion"] is JsonObject image)
            {
                Keep(image, "imageMediaId", "sourceId", "masks", "targetMaskIds", "mode");
                if (image["masks"] is JsonArray masks)
                    foreach (var mask in masks.OfType<JsonObject>()) NormalizeMask(mask);
            }
        }
    }
    private static void NormalizeType(JsonObject type, bool preservePrivate)
    {
        Keep(type, "id", "name", "fields", "templates");
        if (type["fields"] is JsonArray fields)
            foreach (var field in fields.OfType<JsonObject>()) Keep(field, "name", "sticky");
        if (type["templates"] is JsonArray templates)
            foreach (var template in templates.OfType<JsonObject>())
            {
                if (preservePrivate) Keep(template, "id", "name", "front", "back", "clozeField", "presentation", "deckAreaId");
                else Keep(template, "id", "name", "front", "back", "clozeField", "presentation");
                if (template["presentation"] is JsonObject presentation) NormalizePresentation(presentation);
            }
    }
    private static void NormalizePresentation(JsonObject presentation)
    {
        Keep(presentation, "typedAnswer", "speech", "appearance");
        if (presentation["appearance"] is JsonObject appearance) Keep(appearance, "font", "size", "align", "lineSpacing");
        if (presentation["typedAnswer"] is JsonObject answer) Keep(answer, "enabled", "ignoreCase", "ignoreAccents");
        if (presentation["speech"] is not JsonObject speech) return;
        Keep(speech, "front", "back");
        foreach (var field in new[] { "front", "back" })
            if (speech[field] is JsonObject settings) Keep(settings, "language", "voice", "rate", "autoplay");
    }
    private static void NormalizeMask(JsonObject mask)
    {
        Keep(mask, "id", "label", "groupId", "shape", "points");
        if (mask["points"] is JsonArray points)
            foreach (var point in points.OfType<JsonObject>()) Keep(point, "x", "y");
    }
    private static void NormalizeMedia(JsonObject parent)
    {
        if (parent["media"] is JsonArray media)
            foreach (var reference in media.OfType<JsonObject>()) Keep(reference, "id", "mimeType", "byteLength");
    }
    private static void Keep(JsonObject value, params string[] allowed)
    {
        foreach (var key in value.Select(pair => pair.Key).ToArray())
            if (!allowed.Contains(key, StringComparer.Ordinal)) value.Remove(key);
    }
}
