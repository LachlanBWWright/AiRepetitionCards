using System.Text.Json;
using Json.Schema;
using Recall.Api.Contracts;

if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: Recall.ContractChecks <repository-root>");
    return 1;
}
var root = Path.GetFullPath(args[0]);
var fixtures = Path.Combine(root, "contracts", "fixtures", "dotnet-v1");
using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtures, "manifest.json")));
var schemas = new Dictionary<string, JsonSchema>
{
    ["auth-session"] = JsonSchema.FromFile(Path.Combine(root, "contracts/generated/auth-session.schema.json")),
    ["workspace-snapshot"] = JsonSchema.FromFile(Path.Combine(root, "contracts/generated/workspace-snapshot.schema.json"))
};
var failures = new List<string>();
var count = 0;
foreach (var entry in manifest.RootElement.EnumerateArray())
{
    var file = entry.GetProperty("file").GetString()!;
    var contract = entry.GetProperty("contract").GetString()!;
    using var payload = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtures, file)));
    var value = payload.RootElement;
    var evaluation = schemas[contract].Evaluate(value);
    var shapeValid = evaluation.IsValid;
    var semantic = contract == "auth-session"
        ? ContractBoundaryValidator.ValidateAuthSession(value)
        : ContractBoundaryValidator.ValidateWorkspaceSnapshot(value);
    if (shapeValid != entry.GetProperty("schemaValid").GetBoolean())
        failures.Add($"{file}: generated JSON Schema disagrees with expected shape validity");
    if ((shapeValid && semantic.IsValid) != entry.GetProperty("valid").GetBoolean())
        failures.Add($"{file}: C# boundary validation disagrees with expected validity ({semantic.ErrorCode})");
    count++;
}
failures.AddRange(AuthoredMetadataChecks.Run());
failures.AddRange(PublishingMetadataChecks.Run());
if (count < 15) failures.Add("The shared contract corpus is incomplete.");
foreach (var failure in failures) Console.Error.WriteLine(failure);
Console.WriteLine($"Shared contract fixtures: {count} checked, {failures.Count} failures.");
return failures.Count == 0 ? 0 : 1;
