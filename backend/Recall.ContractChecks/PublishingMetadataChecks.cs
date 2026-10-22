using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Recall.Api.Features.Publishing;

internal static class PublishingMetadataChecks
{
    internal static IReadOnlyList<string> Run()
    {
        var failures = new List<string>();
        void Check(bool valid, string message) { if (!valid) failures.Add(message); }
        const BindingFlags flags = BindingFlags.NonPublic | BindingFlags.Static;
        var endpoints = typeof(PublishingEndpoints);
        var find = endpoints.GetMethod("FindMediaReference", flags);
        var id = new string('a', 64);
        var reference = new { id, mimeType = "image/png", byteLength = 8 };
        var content = JsonSerializer.SerializeToElement(new
        {
            cards = Array.Empty<object>(),
            noteLibrary = new { notes = new[] { new { media = new[] { reference } } } }
        });
        Check(find?.Invoke(null, [content, id]) is not null,
            "Published note-only media should be discoverable after publication authorization.");
        Check(find is not null && find.Invoke(null, [content, new string('b', 64)]) is null,
            "Published media lookup must reject an ID absent from cards and notes.");
        var cardContent = JsonSerializer.SerializeToElement(new { cards = new[] { new { media = new[] { reference } } } });
        Check(find?.Invoke(null, [cardContent, id]) is not null,
            "Published card media should remain discoverable.");

        var document = JsonNode.Parse("""
        {"noteLibrary":{"notes":[{"objectiveIds":["old"]}]},
         "cards":[{"kind":"basic","noteId":"note","templateId":"forward","presentation":{},"imageOcclusion":{}}],
         "objectives":[]}
        """)!.AsObject();
        var remap = endpoints.GetMethod("RemapForkNoteObjectives", flags);
        var objectives = new Dictionary<string, string> { ["old"] = "new" };
        Check(remap?.Invoke(null, [document, objectives]) is true &&
            document["noteLibrary"]!["notes"]![0]!["objectiveIds"]![0]!.GetValue<string>() == "new",
            "Publication forks must remap note objectives to the fork's objectives.");
        var normalize = endpoints.GetMethod("NormalizeForkDocument", flags);
        normalize?.Invoke(null, [document, document["objectives"]!.AsArray(), document["cards"]!.AsArray()]);
        Check(normalize is not null && document["noteLibrary"] is JsonObject &&
            document["cards"]![0]!["noteId"]?.GetValue<string>() == "note" &&
            document["cards"]![0]!["templateId"]?.GetValue<string>() == "forward" &&
            document["cards"]![0]!["presentation"] is JsonObject &&
            document["cards"]![0]!["imageOcclusion"] is JsonObject,
            "Fork normalization must preserve linked notes, templates, presentation and image occlusion.");
        Check(remap?.Invoke(null, [document, new Dictionary<string, string>()]) is false,
            "Publication forks must reject a note objective without a source-objective mapping.");
        return failures;
    }
}
