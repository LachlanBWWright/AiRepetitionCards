using System.Text.Json;
using System.Text.Json.Nodes;
using Recall.Api.Contracts;

internal static class WorkspaceScaleChecks
{
    public static IEnumerable<string> Run(string root)
    {
        var path = Path.Combine(root, "contracts/fixtures/dotnet-v1/workspace-populated.json");
        var snapshot = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        var document = snapshot["areas"]![0]!["document"]!.AsObject();
        var original = document["cards"]![0]!.DeepClone();
        var cards = new JsonArray();
        document["cards"] = cards;
        for (var index = 0; index < 501; index++)
        {
            var card = original.DeepClone();
            card["id"] = Guid.NewGuid().ToString();
            cards.Add(card);
        }
        if (!Validate(snapshot)) yield return "A workspace with 501 cards must remain readable after sync.";
        for (var index = 501; index < 50_001; index++)
        {
            var card = original.DeepClone();
            card["id"] = Guid.NewGuid().ToString();
            cards.Add(card);
        }
        if (Validate(snapshot)) yield return "A workspace above the 50,000-card collection limit must be rejected.";
    }

    private static bool Validate(JsonObject snapshot)
    {
        using var parsed = JsonDocument.Parse(snapshot.ToJsonString());
        return ContractBoundaryValidator.ValidateWorkspaceSnapshot(parsed.RootElement).IsValid;
    }
}
