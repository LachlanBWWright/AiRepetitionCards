using System.Text.Json;
namespace Recall.Api.Contracts;
public static partial class ContractBoundaryValidator
{
    public static ContractValidationResult ValidateManagedAiStatus(JsonElement value)
    {
        if (!IsObject(value) || !IsSchemaVersionOne(value) || !HasOnly(value, "schemaVersion", "accountId", "available", "dailyLimitMicrousd", "usedMicrousd", "requestLimit", "requestsUsed", "expiresAt") ||
            !Has(value, "accountId", JsonValueKind.String) || !IsUuid(value.GetProperty("accountId").GetString()) ||
            !Has(value, "available", JsonValueKind.True, JsonValueKind.False) || !Has(value, "expiresAt", JsonValueKind.String, JsonValueKind.Null))
            return ContractValidationResult.Invalid("invalid-managed-ai-status");
        foreach (var name in new[] { "dailyLimitMicrousd", "usedMicrousd", "requestLimit", "requestsUsed" })
            if (!value.TryGetProperty(name, out var count) || !count.TryGetInt64(out var number) || number < 0 || number > 9007199254740991)
                return ContractValidationResult.Invalid("invalid-managed-ai-allowance");
        return ContractValidationResult.Valid;
    }
}
