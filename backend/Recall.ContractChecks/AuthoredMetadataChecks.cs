using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Recall.Api.Contracts;
using Recall.Api.Features.Publishing;

internal static class AuthoredMetadataChecks
{
    internal static IReadOnlyList<string> Run()
    {
        var failures = new List<string>();
        var document = JsonNode.Parse("""
        {"cards":[{"kind":"basic","id":"card","front":"Q","back":"A","noteId":"note","templateId":"forward",
          "presentation":{"appearance":{"font":"serif","size":"large","align":"left","lineSpacing":"comfortable"},"typedAnswer":{"enabled":true,"ignoreCase":true,"ignoreAccents":false},"speech":{"front":{"language":"en-AU","rate":1,"autoplay":false}}},
          "imageOcclusion":{"imageMediaId":"image","sourceId":"source","mode":"hide-all","targetMaskIds":["mask"],"masks":[{"id":"mask","label":"A","shape":"rectangle","points":[{"x":0.1,"y":0.2},{"x":0.8,"y":0.9}]}]},
          "importedSchedule":{"due":"private","reps":12}}],
          "noteLibrary":{"types":[{"id":"type","name":"Basic","fields":[{"name":"Front","sticky":true}],"templates":[{"id":"forward","name":"Forward","front":"{{Front}}","back":"Answer"}]}],"notes":[{"id":"note","typeId":"type","fields":{"Front":"Question"},"tags":[],"objectiveIds":[]}]}}
        """)!.AsObject();
        void Check(bool valid, string message) { if (!valid) failures.Add(message); }
        bool Valid(JsonObject value) => AuthoredMetadataValidator.Validate(JsonSerializer.SerializeToElement(value));
        Check(Valid(document), "Authored note/presentation/occlusion metadata should be accepted.");
        var invalid = (JsonObject)document.DeepClone();
        invalid["cards"]![0]!["presentation"]!["appearance"]!["font"] = "url(evil)";
        Check(!Valid(invalid), "Appearance values must use the safe declarative vocabulary.");
        invalid = (JsonObject)document.DeepClone();
        invalid["cards"]![0]!["presentation"]!["appearance"]!["css"] = "position:fixed";
        AuthoredMetadataValidator.Normalize(invalid);
        Check(invalid["cards"]![0]!["presentation"]!["appearance"]!["css"] is null && Valid(invalid), "Appearance normalization must retain safe settings and remove arbitrary styling.");
        invalid = (JsonObject)document.DeepClone();
        invalid["cards"]![0]!["presentation"]!["speech"]!["front"]!["rate"] = 9;
        Check(!Valid(invalid), "Out-of-range speech rate must be rejected.");
        invalid = (JsonObject)document.DeepClone();
        invalid["cards"]![0]!["imageOcclusion"]!["targetMaskIds"]![0] = "unknown";
        Check(!Valid(invalid), "Unknown occlusion target must be rejected.");
        invalid = (JsonObject)document.DeepClone();
        invalid["cards"]![0]!["imageOcclusion"]!["masks"]![0]!["points"]![0]!["x"] = -1;
        Check(!Valid(invalid), "Out-of-bounds occlusion coordinate must be rejected.");
        invalid = (JsonObject)document.DeepClone();
        invalid["noteLibrary"]!["notes"]![0]!["typeId"] = "missing";
        Check(!Valid(invalid), "Unknown note type reference must be rejected.");
        invalid = (JsonObject)document.DeepClone();
        invalid["noteLibrary"]!["types"]![0]!["fields"]!.AsArray().Add(invalid["noteLibrary"]!["types"]![0]!["fields"]![0]!.DeepClone());
        Check(!Valid(invalid), "Duplicate note fields must be rejected.");
        Check(AuthoredMetadataValidator.ValidCloze("{{c1::A {{c2::nested::hint}} answer}}", 2), "Nested cloze should accept a selected inner deletion.");
        Check(!AuthoredMetadataValidator.ValidCloze("{{c1::A {{c2::nested}}", 1), "Unclosed nested cloze must be rejected.");
        Check(!AuthoredMetadataValidator.ValidCloze("{{c1::answer}}", 2), "Missing selected deletion must be rejected.");
        Check(!AuthoredMetadataValidator.ValidCloze("{{c1::answer::hint::extra}}", 1), "Malformed hint must be rejected.");
        invalid = (JsonObject)document.DeepClone();
        invalid["cards"]![0]!["presentation"]!["typedAnswer"]!["privateData"] = "remove";
        AuthoredMetadataValidator.Normalize(invalid);
        Check(invalid["cards"]![0]!["presentation"]!["typedAnswer"]!["privateData"] is null && Valid(invalid), "Normalization must remove unknown nested metadata while preserving authored fields.");
        var withTemplateSettings = (JsonObject)document.DeepClone();
        withTemplateSettings["noteLibrary"]!["types"]![0]!["templates"]![0]!["presentation"] = document["cards"]![0]!["presentation"]!.DeepClone();
        Check(Valid(withTemplateSettings), "Note templates should support validated review presentation settings.");
        AuthoredMetadataValidator.Normalize(withTemplateSettings);
        Check(withTemplateSettings["noteLibrary"]!["types"]![0]!["templates"]![0]!["presentation"] is JsonObject, "Template presentation settings must survive normalization.");
        Check(withTemplateSettings["noteLibrary"]!["types"]![0]!["templates"]![0]!["presentation"]!["appearance"]!["font"]!.GetValue<string>() == "serif", "Reusable template appearance must survive normalization.");
        withTemplateSettings["noteLibrary"]!["types"]![0]!["templates"]![0]!["presentation"]!["speech"]!["front"]!["rate"] = 9;
        Check(!Valid(withTemplateSettings), "Malformed template review settings must be rejected.");
        var normalize = typeof(PublishingEndpoints).GetMethod("NormalizeKnowledgeArea", BindingFlags.NonPublic | BindingFlags.Static);
        var normalized = normalize?.Invoke(null, [JsonSerializer.SerializeToElement(document)]) as JsonElement?;
        Check(normalized is { } publication && publication.TryGetProperty("noteLibrary", out _) && publication.GetProperty("cards")[0].TryGetProperty("presentation", out _) && publication.GetProperty("cards")[0].TryGetProperty("imageOcclusion", out _) && !publication.GetProperty("cards")[0].TryGetProperty("importedSchedule", out _), "Publication normalization must preserve authored metadata and remove private imported schedules.");
        var syncType = typeof(PublishingEndpoints).Assembly.GetType("Recall.Api.Features.Sync.SyncHandlers");
        var normalizeSync = syncType?.GetMethod("NormalizeWorkspaceDocument", BindingFlags.NonPublic | BindingFlags.Static);
        var syncDocument = normalizeSync?.Invoke(null, [document]) as JsonObject;
        Check(syncDocument is not null && syncDocument["noteLibrary"] is JsonObject && syncDocument["cards"]![0]!["presentation"] is JsonObject && syncDocument["cards"]![0]!["imageOcclusion"] is JsonObject && Valid(syncDocument), "Private workspace normalization must retain and validate all authored metadata.");
        var linked = (JsonObject)document.DeepClone();
        linked["noteLibrary"]!["notes"]![0]!["source"] = new JsonObject { ["areaId"] = "private-owner", ["noteId"] = "original-note", ["revision"] = new string('a', 64) };
        linked["noteLibrary"]!["types"]![0]!["templates"]![0]!["deckAreaId"] = "private-destination";
        Check(Valid(linked), "Canonical note ownership and template subjects should validate at private boundaries.");
        var linkedSync = (JsonObject)linked.DeepClone();
        AuthoredMetadataValidator.Normalize(linkedSync, preservePrivate: true);
        Check(linkedSync["noteLibrary"]!["notes"]![0]!["source"]?["revision"]?.GetValue<string>() == new string('a', 64) && linkedSync["noteLibrary"]!["types"]![0]!["templates"]![0]!["deckAreaId"]?.GetValue<string>() == "private-destination", "Private sync normalization must preserve linked note identities and template destinations.");
        AuthoredMetadataValidator.Normalize(linked);
        Check(linked["noteLibrary"]!["notes"]![0]!["source"] is null && linked["noteLibrary"]!["types"]![0]!["templates"]![0]!["deckAreaId"] is null, "Publishing normalization must remove private note ownership and template destinations.");
        byte[] mp4 = [0, 0, 0, 20, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0, 105, 115, 111, 109];
        byte[] webm = [0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 119, 101, 98, 109, 0x18, 0x53, 0x80, 0x67];
        Check(MediaContentSignatures.IsMp4Audio(mp4) && MediaContentSignatures.IsWebmAudio(webm), "Recorded audio containers should pass server signature validation.");
        Check(!MediaContentSignatures.IsMp4Audio(webm) && !MediaContentSignatures.IsWebmAudio(mp4), "Mislabeled recording formats must be rejected.");
        mp4[3] = 255;
        webm[8] = 0;
        Check(!MediaContentSignatures.IsMp4Audio(mp4) && !MediaContentSignatures.IsWebmAudio(webm), "Malformed recording headers must be rejected.");
        return failures;
    }
}
