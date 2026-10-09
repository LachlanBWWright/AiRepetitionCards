using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Publishing;

public static partial class PublishingEndpoints
{
    private static async Task<IResult> ForkPublishedAsync(
        HttpContext context, string versionId, IHttpClientFactory clients, IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var principal = await AuthenticateBearerAsync(context);
        var identity = principal is null ? null : SupabaseUserIdentity.TryResolve(principal);
        var authorization = context.Request.Headers.Authorization.ToString();
        if (identity is null || !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return Error("unauthenticated", 401);
        if (!TryGuid(versionId, out var sourceVersionId)) return Error("source-version-not-found", 404);
        if (!TryConfiguration(configuration, out var projectUrl, out var key)) return Error("publication-unavailable", 503);
        JsonDocument? body = null;
        try
        {
            if (context.Request.ContentLength is > 4_096) return Error("request-too-large", 413);
            if (context.Request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) != true)
                return Error("invalid-request", 400);
            var requestBytes = await ReadBoundedBodyAsync(context.Request.Body, 4_096, cancellationToken);
            if (requestBytes is null) return Error("request-too-large", 413);
            body = JsonDocument.Parse(requestBytes);
            var root = body.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("schemaVersion", out var schemaVersion) || schemaVersion.ValueKind != JsonValueKind.Number ||
                !schemaVersion.TryGetInt32(out var version) || version != 1 ||
                !RequiredString(root, "operationId", out var operationText) ||
                !TryGuid(operationText, out var operationId)) return Error("invalid-request", 400);
            if (root.TryGetProperty("shareToken", out var shareTokenElement) && shareTokenElement.ValueKind != JsonValueKind.String)
                return Error("invalid-request", 400);
            var shareToken = OptionalJsonString(root, "shareToken");
            if (shareToken is not null && !ValidShareToken(shareToken)) return Error("invalid-request", 400);
            var query = context.Request.Query;
            if (query.Keys.Any(name => name != "token") || query.TryGetValue("token", out var queryTokens) && queryTokens.Count != 1)
                return Error("invalid-share-token", 400);
            if (query.TryGetValue("token", out queryTokens))
            {
                var queryToken = queryTokens.ToString();
                if (!ValidShareToken(queryToken)) return Error("invalid-share-token", 400);
                shareToken ??= queryToken;
            }
            using var client = clients.CreateClient();
            var accessToken = authorization[7..].Trim();
            var areaId = ForkId(identity.UserId, sourceVersionId, operationId, "area");
            var initialVersionId = ForkId(identity.UserId, sourceVersionId, operationId, "initial-version");

            var recovered = await RecoverForkAsync(client, projectUrl, key, accessToken, identity.UserId, areaId, initialVersionId, operationId, sourceVersionId, cancellationToken);
            if (recovered is not null) return recovered;

            using var sourceResponse = shareToken is null
                ? await GetAsync(client, projectUrl, key,
                    $"published_knowledge_area_versions?select=id,content,content_hash,attribution,license,created_at&id=eq.{sourceVersionId:D}&visibility=eq.public&limit=1", null, cancellationToken)
                : await PostRpcAsync(client, projectUrl, key, "read_unlisted_knowledge_area_version",
                    new { p_version_id = sourceVersionId, p_share_token_hash = Hash(shareToken) }, cancellationToken);
            if (!sourceResponse.IsSuccessStatusCode) return Error("source-version-not-found", 404);
            using var sourceJson = await ParseJsonAsync(sourceResponse, cancellationToken);
            var sourceRow = sourceJson is null ? null : FirstRow(sourceJson.RootElement);
            if (sourceRow is null || !sourceRow.Value.TryGetProperty("content", out var rawSourceContent) || rawSourceContent.ValueKind != JsonValueKind.Object ||
                !TryString(sourceRow.Value, "content_hash", out var sourceHash) ||
                !OptionalNullableString(sourceRow.Value, "attribution", 500) || !OptionalNullableString(sourceRow.Value, "license", 120))
                return Error("source-version-invalid", 502);
            var normalizedSource = NormalizeKnowledgeArea(rawSourceContent);
            if (normalizedSource is null) return Error("source-version-invalid", 502);
            var sourceContent = normalizedSource.Value;
            if (!ValidPortableDocument(sourceContent) ||
                !string.Equals(sourceHash, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(sourceContent)))).ToLowerInvariant(), StringComparison.Ordinal))
                return Error("source-version-invalid", 502);
            var sourceDocument = JsonNode.Parse(sourceContent.GetRawText())?.AsObject();
            if (sourceDocument is null || !sourceDocument.TryGetPropertyValue("objectives", out var objectivesNode) || objectivesNode is not JsonArray objectives ||
                !sourceDocument.TryGetPropertyValue("cards", out var cardsNode) || cardsNode is not JsonArray cards ||
                !TryString(sourceContent, "id", out var originalAreaId) || !TryGuid(originalAreaId, out _))
                return Error("source-version-invalid", 502);
            NormalizeForkDocument(sourceDocument, objectives, cards);

            var objectiveIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var objective in objectives.OfType<JsonObject>())
            {
                var oldId = objective["id"]?.GetValue<string>();
                if (oldId is null || !TryGuid(oldId, out _)) return Error("source-version-invalid", 502);
                objectiveIds[oldId!] = ForkId(identity.UserId, sourceVersionId, operationId, "objective", oldId!).ToString("D").ToLowerInvariant();
            }
            var forkObjectives = new JsonArray();
            foreach (var objective in objectives.OfType<JsonObject>())
            {
                var copy = (JsonObject)objective.DeepClone();
                var oldId = copy["id"]!.GetValue<string>();
                copy["id"] = objectiveIds[oldId];
                if (copy["sourceId"] is null) copy["sourceId"] = oldId;
                if (copy["prerequisiteIds"] is JsonArray prerequisites)
                    for (var index = 0; index < prerequisites.Count; index++)
                    {
                        var oldPrerequisite = prerequisites[index]?.GetValue<string>();
                        if (oldPrerequisite is null || !objectiveIds.TryGetValue(oldPrerequisite, out var newPrerequisite)) return Error("source-version-invalid", 502);
                        prerequisites[index] = newPrerequisite;
                    }
                forkObjectives.Add(copy);
            }

            var forkCards = new JsonArray();
            foreach (var card in cards.OfType<JsonObject>())
            {
                var copy = (JsonObject)card.DeepClone();
                var oldId = copy["id"]?.GetValue<string>();
                if (oldId is null || !TryGuid(oldId, out _)) return Error("source-version-invalid", 502);
                copy["id"] = ForkId(identity.UserId, sourceVersionId, operationId, "card", oldId!).ToString("D").ToLowerInvariant();
                copy["revisionId"] = ForkId(identity.UserId, sourceVersionId, operationId, "card-revision", oldId!).ToString("D").ToLowerInvariant();
                if (copy["sourceId"] is null) copy["sourceId"] = oldId;
                if (copy["objectiveIds"] is JsonArray cardObjectives)
                    for (var index = 0; index < cardObjectives.Count; index++)
                    {
                        var oldObjective = cardObjectives[index]?.GetValue<string>();
                        if (oldObjective is null || !objectiveIds.TryGetValue(oldObjective, out var newObjective)) return Error("source-version-invalid", 502);
                        cardObjectives[index] = newObjective;
                    }
                forkCards.Add(copy);
            }
            var forkAttribution = OptionalJsonString(sourceRow.Value, "attribution") ?? OptionalJsonString(sourceContent, "attribution");
            var forkLicense = OptionalJsonString(sourceRow.Value, "license") ?? OptionalJsonString(sourceContent, "licence");
            sourceDocument["id"] = areaId.ToString("D").ToLowerInvariant();
            sourceDocument["sourceId"] = OptionalJsonString(sourceContent, "sourceId") ?? originalAreaId;
            sourceDocument["forkedFromVersionId"] = sourceVersionId.ToString("D").ToLowerInvariant();
            sourceDocument["attribution"] = forkAttribution;
            sourceDocument["licence"] = forkLicense;
            sourceDocument["objectives"] = forkObjectives;
            sourceDocument["cards"] = forkCards;
            using var forkDocument = JsonDocument.Parse(sourceDocument.ToJsonString());
            var forkHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(forkDocument.RootElement)))).ToLowerInvariant();
            var areaPayload = new JsonObject
            {
                ["id"] = areaId.ToString("D").ToLowerInvariant(),
                ["title"] = sourceDocument["title"]?.DeepClone(),
                ["description"] = sourceDocument["description"]?.DeepClone(),
                ["language"] = sourceDocument["language"]?.DeepClone(),
                ["color"] = "#5965d8",
                ["tags"] = sourceDocument["tags"]?.DeepClone(),
                ["objectives"] = sourceDocument["objectives"]?.DeepClone(),
                ["cards"] = sourceDocument["cards"]?.DeepClone(),
                ["document"] = sourceDocument.DeepClone(),
                ["versionId"] = initialVersionId.ToString("D").ToLowerInvariant(),
                ["contentHash"] = forkHash,
                ["baseContentHash"] = null
            };
            var areas = new JsonArray(areaPayload);
            var rpcBody = JsonContent.Create(new { p_areas = areas, p_tombstones = new JsonArray() });
            using var saveRequest = BuildRequest(HttpMethod.Post, projectUrl, key, "rpc/sync_workspace_content", accessToken);
            saveRequest.Content = rpcBody;
            using var saveResponse = await SendAsync(client, saveRequest, cancellationToken);
            if (!saveResponse.IsSuccessStatusCode) return Error("fork-save-failed", 502);
            using var saveJson = await ParseJsonAsync(saveResponse, cancellationToken);
            if (saveJson is null || saveJson.RootElement.ValueKind != JsonValueKind.True)
            {
                var afterSaveRecovery = await RecoverForkAsync(client, projectUrl, key, accessToken, identity.UserId, areaId, initialVersionId, operationId, sourceVersionId, cancellationToken);
                return afterSaveRecovery ?? Error("fork-save-conflict", 409);
            }
            context.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new
            {
                schemaVersion = 1,
                operationId = operationId.ToString("D").ToLowerInvariant(),
                saved = true,
                areaId = areaId.ToString("D").ToLowerInvariant(),
                contentHash = forkHash,
                document = forkDocument.RootElement,
                attribution = forkAttribution,
                license = forkLicense,
                forkedFromVersionId = sourceVersionId.ToString("D").ToLowerInvariant()
            });
        }
        catch (JsonException) { return Error("invalid-request", 400); }
        catch (IOException) { return Error("fork-save-failed", 502); }
        catch (InvalidOperationException) { return Error("source-version-invalid", 502); }
        finally { body?.Dispose(); }
    }

    private static async Task<IResult?> RecoverForkAsync(HttpClient client, string projectUrl, string key, string accessToken,
        Guid ownerId, Guid areaId, Guid initialVersionId, Guid operationId, Guid sourceVersionId, CancellationToken cancellationToken)
    {
        using var response = await GetAsync(client, projectUrl, key,
            $"knowledge_areas?select=id,deleted_at&id=eq.{areaId:D}&owner_id=eq.{ownerId:D}&limit=1", accessToken, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("fork-save-failed", 502);
        using var areaJson = await ParseJsonAsync(response, cancellationToken);
        var area = areaJson is null ? null : FirstRow(areaJson.RootElement);
        if (area is null) return null;
        if (area.Value.TryGetProperty("deleted_at", out var deleted) && deleted.ValueKind != JsonValueKind.Null)
            return Error("fork-operation-conflict", 409);
        using var versionResponse = await GetAsync(client, projectUrl, key,
            $"knowledge_area_versions?select=id,knowledge_area_id,content,content_hash,created_by&id=eq.{initialVersionId:D}&knowledge_area_id=eq.{areaId:D}&created_by=eq.{ownerId:D}&limit=1", accessToken, cancellationToken);
        if (!versionResponse.IsSuccessStatusCode) return Error("fork-save-failed", 502);
        using var versionJson = await ParseJsonAsync(versionResponse, cancellationToken);
        var row = versionJson is null ? null : FirstRow(versionJson.RootElement);
        if (row is null || !row.Value.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object ||
            !ValidPortableDocument(content) ||
            !TryString(row.Value, "content_hash", out var contentHash) ||
            !string.Equals(contentHash, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(content)))).ToLowerInvariant(), StringComparison.Ordinal) ||
            !TryString(content, "id", out var idText) || !TryGuid(idText, out var actualArea) || actualArea != areaId ||
            !TryString(content, "forkedFromVersionId", out var sourceText) || !TryGuid(sourceText, out var actualSource) || actualSource != sourceVersionId)
            return Error("fork-operation-conflict", 409);
        return Results.Json(new
        {
            schemaVersion = 1,
            operationId = operationId.ToString("D").ToLowerInvariant(),
            saved = true,
            areaId = areaId.ToString("D").ToLowerInvariant(),
            contentHash,
            document = content.Clone(),
            attribution = OptionalJsonString(content, "attribution"),
            license = OptionalJsonString(content, "licence"),
            forkedFromVersionId = sourceVersionId.ToString("D").ToLowerInvariant()
        });
    }

    private static Guid ForkId(Guid ownerId, Guid sourceId, Guid operationId, string kind, string sourceKey = "")
    {
        var seed = JsonSerializer.Serialize(new[] { "recall-publication-fork-v1", ownerId.ToString("D").ToLowerInvariant(), sourceId.ToString("D").ToLowerInvariant(), operationId.ToString("D").ToLowerInvariant(), kind, sourceKey }, CanonicalJsonOptions);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(seed))).ToLowerInvariant();
        var variant = (8 + (Convert.ToInt32(hash[16].ToString(), 16) & 3)).ToString("x");
        return Guid.Parse($"{hash[..8]}-{hash[8..12]}-5{hash[13..16]}-{variant}{hash[17..20]}-{hash[20..32]}");
    }

    // decodeAndMigrateKnowledgeArea only migrates v0.9.0; the publication reader already rejects that
    // version, so the fork boundary mirrors the current 1.0.0 schema decoder by stripping unknown keys.
    private static void NormalizeForkDocument(JsonObject document, JsonArray objectives, JsonArray cards)
    {
        KeepOnly(document, "schemaVersion", "id", "sourceId", "title", "description", "language", "objectives", "ai", "cards", "tags", "licence", "attribution", "forkedFromVersionId");
        foreach (var objective in objectives.OfType<JsonObject>())
            KeepOnly(objective, "id", "title", "description", "prerequisiteIds", "sourceId");
        if (document["ai"] is JsonObject ai)
            KeepOnly(ai, "tutorInstructions", "quizInstructions", "cardGenerationInstructions");
        foreach (var card in cards.OfType<JsonObject>())
        {
            if (card["kind"]?.GetValue<string>() == "basic")
                KeepOnly(card, "kind", "id", "front", "back", "objectiveIds", "media", "tags", "origin", "sourceId");
            else
                KeepOnly(card, "kind", "id", "text", "deletionIndex", "objectiveIds", "media", "tags", "origin", "sourceId");
        }
    }

    private static void KeepOnly(JsonObject value, params string[] allowed)
    {
        var allowedSet = new HashSet<string>(allowed, StringComparer.Ordinal);
        foreach (var name in value.Select(property => property.Key).ToArray())
            if (!allowedSet.Contains(name)) value.Remove(name);
    }
}
