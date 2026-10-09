using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Recall.Api.Contracts;
using Recall.Infrastructure.SupabaseAuth;
using Microsoft.AspNetCore.Authentication;

namespace Recall.Api.Features.Publishing;

public static partial class PublishingEndpoints
{
    private static async Task<IResult> CreatePublicationAsync(
        HttpContext context,
        IHttpClientFactory clients,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var principal = await AuthenticateBearerAsync(context);
        var identity = principal is null ? null : SupabaseUserIdentity.TryResolve(principal);
        var authorization = context.Request.Headers.Authorization.ToString();
        if (identity is null || !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var projectUrl, out var key))
            return Error("publication-unavailable", 503);

        JsonDocument? parsed = null;
        try
        {
            if (context.Request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) != true)
                return Error("invalid-request", 400);
            if (context.Request.ContentLength is > 1_000_000) return Error("request-too-large", 413);
            var requestBytes = await ReadBoundedBodyAsync(context.Request.Body, 1_000_000, cancellationToken);
            if (requestBytes is null) return Error("request-too-large", 413);
            parsed = JsonDocument.Parse(requestBytes);
            var root = parsed.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !RequiredString(root, "operationId", out var operationId) || !TryGuid(operationId, out var operationGuid) ||
                !RequiredString(root, "sourceAreaId", out var sourceAreaId) || !TryGuid(sourceAreaId, out var sourceGuid) ||
                !RequiredString(root, "visibility", out var visibility) || visibility is not ("private" or "public" or "unlisted") ||
                !root.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object ||
                !content.TryGetProperty("id", out var contentId) || contentId.ValueKind != JsonValueKind.String ||
                !TryGuid(contentId.GetString() ?? string.Empty, out var contentGuid) || contentGuid != sourceGuid ||
                !string.Equals(contentId.GetString(), sourceGuid.ToString("D").ToLowerInvariant(), StringComparison.Ordinal))
                return Error("invalid-request", 400);
            if (!root.TryGetProperty("schemaVersion", out var schemaVersion) || schemaVersion.ValueKind != JsonValueKind.Number ||
                !schemaVersion.TryGetInt32(out var version) || version != 1) return Error("invalid-request", 400);
            var reuseConfirmed = root.TryGetProperty("reuseConfirmed", out var reuseConfirmation) &&
                reuseConfirmation.ValueKind is JsonValueKind.True or JsonValueKind.False && reuseConfirmation.GetBoolean();
            if (root.TryGetProperty("reuseConfirmed", out reuseConfirmation) &&
                reuseConfirmation.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Error("invalid-request", 400);
            if (root.TryGetProperty("shareToken", out var suppliedToken) &&
                (suppliedToken.ValueKind != JsonValueKind.String || !ValidShareToken(suppliedToken.GetString() ?? "")))
                return Error("invalid-share-token", 400);
            if (!OptionalNullableString(root, "license", 120) || !OptionalNullableString(root, "attribution", 500))
                return Error("invalid-request", 400);
            var token = OptionalJsonString(root, "shareToken");
            if ((visibility == "unlisted") != (token is not null)) return Error("invalid-request", 400);
            if (visibility != "private" && !reuseConfirmed && RequiresReuseConfirmation(content, OptionalJsonString(root, "license") ?? OptionalJsonString(content, "licence")))
                return Error("publication-rights-required", 400);

            var normalizedArea = NormalizeKnowledgeArea(content);
            if (normalizedArea is null) return Error("invalid-publication", 400);
            content = normalizedArea.Value;
            var contentBox = JsonDocument.Parse("{\"schemaVersion\":1,\"ownerId\":\"00000000-0000-4000-8000-000000000000\",\"areas\":[{\"document\":" + content.GetRawText() + ",\"color\":\"#5965d8\",\"contentHash\":\"" + new string('0', 64) + "\"}],\"deletedAreaIds\":[]}");
            using (contentBox)
            {
                var schema = ContractBoundaryValidator.ValidateWorkspaceSnapshot(contentBox.RootElement);
                if (!schema.IsValid) return Error("invalid-publication", 400);
            }

            var license = FirstNonEmpty(OptionalJsonString(root, "license"), OptionalJsonString(content, "licence"));
            var attribution = FirstNonEmpty(OptionalJsonString(root, "attribution"), OptionalJsonString(content, "attribution"));
            var forkedFrom = OptionalJsonString(content, "forkedFromVersionId");
            if (forkedFrom is not null && !TryGuid(forkedFrom, out _)) return Error("publication-lineage-mismatch", 400);
            if (root.TryGetProperty("forkedFromVersionId", out var assertedLineage))
            {
                if (assertedLineage.ValueKind is not (JsonValueKind.String or JsonValueKind.Null))
                    return Error("publication-lineage-mismatch", 400);
                var asserted = assertedLineage.ValueKind == JsonValueKind.String ? assertedLineage.GetString() : null;
                if (!string.Equals(asserted, forkedFrom, StringComparison.OrdinalIgnoreCase)) return Error("publication-lineage-mismatch", 400);
            }
            if (license is { Length: > 120 } || attribution is { Length: > 500 }) return Error("invalid-publication", 400);
            if (visibility != "private" && string.IsNullOrWhiteSpace(license)) return Error("publication-rights-required", 400);

            var normalizedContent = JsonNodeFrom(content, license, attribution);
            var contentHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(normalizedContent)))).ToLowerInvariant();
            var versionId = DerivePublicationId(identity.UserId, sourceGuid, operationGuid);
            var fingerprint = PublicationFingerprint(sourceGuid, normalizedContent, visibility, attribution, license, forkedFrom);
            var accessToken = authorization[7..].Trim();
            using var client = clients.CreateClient();

            using var existingResponse = await GetAsync(client, projectUrl, key,
                $"published_knowledge_area_versions?select=id,source_area_id,owner_id,version,content,content_hash,visibility,attribution,license,forked_from_version_id,created_at,share_token_hash&id=eq.{versionId:D}&owner_id=eq.{identity.UserId:D}&limit=1",
                accessToken, cancellationToken);
            if (existingResponse.IsSuccessStatusCode)
            {
                using var existingJson = await ParseJsonAsync(existingResponse, cancellationToken);
                var existing = existingJson is null ? null : FirstRow(existingJson.RootElement);
                if (existing is { } row)
                {
                    if (!TryValidatePublication(row, versionId, out var saved) ||
                        !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(fingerprint), Encoding.ASCII.GetBytes(PublicationFingerprint(sourceGuid, saved.Content, visibility, saved.Attribution, saved.License, saved.ForkedFromVersionId))))
                        return Error("publication-operation-conflict", 409);
                    var recoveredToken = token is not null && TryString(row, "share_token_hash", out var storedHash) &&
                        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(token)), Encoding.ASCII.GetBytes(storedHash)) ? token : null;
                    context.Response.Headers.CacheControl = "private, no-store";
                    return Results.Json(PublishResponse(operationGuid, versionId, sourceGuid, visibility, saved, recoveredToken));
                }
            }
            else return Error("publication-unavailable", 503);

            var mediaError = await VerifyPublicationMediaAsync(content, identity.UserId, projectUrl, key,
                accessToken, clients, cancellationToken);
            if (mediaError is not null) return mediaError;

            using var areaResponse = await GetAsync(client, projectUrl, key,
                $"knowledge_areas?select=id&id=eq.{sourceGuid:D}&owner_id=eq.{identity.UserId:D}&deleted_at=is.null&limit=1",
                accessToken, cancellationToken);
            if (!areaResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
            using var areaJson = await ParseJsonAsync(areaResponse, cancellationToken);
            if (areaJson is null || FirstRow(areaJson.RootElement) is null) return Error("area-not-found", 404);

            if (forkedFrom is not null)
            {
                using var initialResponse = await GetAsync(client, projectUrl, key,
                    $"knowledge_area_versions?select=content&knowledge_area_id=eq.{sourceGuid:D}&created_by=eq.{identity.UserId:D}&order=version.asc&limit=1",
                    accessToken, cancellationToken);
                if (!initialResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
                using var initialJson = await ParseJsonAsync(initialResponse, cancellationToken);
                var initial = initialJson is null ? null : FirstRow(initialJson.RootElement);
                var inherited = initial is { } initialVersion && initialVersion.TryGetProperty("content", out var initialContent) &&
                    string.Equals(OptionalJsonString(initialContent, "forkedFromVersionId"), forkedFrom, StringComparison.OrdinalIgnoreCase);
                if (!inherited)
                {
                    using var sourceCheck = await GetAsync(client, projectUrl, key,
                        $"published_knowledge_area_versions?select=id&id=eq.{forkedFrom}&limit=1", accessToken, cancellationToken);
                    if (!sourceCheck.IsSuccessStatusCode) return Error("publication-unavailable", 503);
                    using var sourceCheckJson = await ParseJsonAsync(sourceCheck, cancellationToken);
                    if (sourceCheckJson is null || FirstRow(sourceCheckJson.RootElement) is null)
                        return Error("source-version-not-found", 404);
                }
            }

            using var latestResponse = await GetAsync(client, projectUrl, key,
                $"published_knowledge_area_versions?select=version&source_area_id=eq.{sourceGuid:D}&order=version.desc&limit=1",
                accessToken, cancellationToken);
            if (!latestResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
            using var latestJson = await ParseJsonAsync(latestResponse, cancellationToken);
            var latestRow = latestJson is null ? null : FirstRow(latestJson.RootElement);
            var nextVersion = latestRow is { } latest && latest.TryGetProperty("version", out var number) && number.TryGetInt32(out var current)
                ? current + 1 : 1;
            if (nextVersion <= 0) return Error("version-conflict", 409);

            var insert = new
            {
                id = versionId,
                source_area_id = sourceGuid,
                owner_id = identity.UserId,
                version = nextVersion,
                content = normalizedContent,
                content_hash = contentHash,
                visibility,
                attribution,
                license,
                forked_from_version_id = forkedFrom,
                share_token_hash = token is null ? null : Hash(token),
                created_by = identity.UserId
            };
            using var insertRequest = BuildRequest(HttpMethod.Post, projectUrl, key,
                "published_knowledge_area_versions?select=id,source_area_id,version,content,content_hash,visibility,attribution,license,forked_from_version_id,created_at", accessToken);
            insertRequest.Headers.TryAddWithoutValidation("Prefer", "return=representation");
            insertRequest.Content = JsonContent.Create(insert);
            using var insertResponse = await SendAsync(client, insertRequest, cancellationToken);
            if (!insertResponse.IsSuccessStatusCode)
            {
                if (insertResponse.StatusCode == System.Net.HttpStatusCode.Conflict) return Error("version-conflict", 409);
                return Error("publication-save-failed", 502);
            }
            using var savedJson = await ParseJsonAsync(insertResponse, cancellationToken);
            var savedRow = savedJson is null ? null : FirstRow(savedJson.RootElement);
            if (savedRow is null || !TryValidatePublication(savedRow.Value, versionId, out var savedPublication))
                return Error("publication-response-invalid", 502);
            context.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(PublishResponse(operationGuid, versionId, sourceGuid, visibility, savedPublication, token), statusCode: 201);
        }
        catch (JsonException) { return Error("invalid-request", 400); }
        catch (IOException) { return Error("invalid-request", 400); }
        finally { parsed?.Dispose(); }
    }

    private static bool RequiredString(JsonElement value, string property, out string result)
    {
        result = string.Empty;
        return value.TryGetProperty(property, out var item) && item.ValueKind == JsonValueKind.String &&
            (result = item.GetString() ?? string.Empty).Length > 0;
    }

    private static string? OptionalJsonString(JsonElement value, string property) =>
        value.TryGetProperty(property, out var item) && item.ValueKind == JsonValueKind.String ? item.GetString() : null;

    private static string? FirstNonEmpty(string? first, string? second) =>
        !string.IsNullOrWhiteSpace(first) ? first.Trim() : !string.IsNullOrWhiteSpace(second) ? second.Trim() : null;

    private static async Task<IResult?> VerifyPublicationMediaAsync(
        JsonElement content,
        Guid ownerId,
        string projectUrl,
        string apiKey,
        string accessToken,
        IHttpClientFactory clients,
        CancellationToken cancellationToken)
    {
        var references = new Dictionary<string, MediaReference>(StringComparer.Ordinal);
        if (content.TryGetProperty("cards", out var cards) && cards.ValueKind == JsonValueKind.Array)
        {
            foreach (var card in cards.EnumerateArray())
            {
                if (!card.TryGetProperty("media", out var media) || media.ValueKind != JsonValueKind.Array) continue;
                foreach (var item in media.EnumerateArray())
                {
                    if (!item.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String ||
                        !TryReadMediaReference(item, idElement.GetString() ?? string.Empty, out var reference))
                        return Error("invalid-publication", 400);
                    references[reference!.Id] = reference;
                }
            }
        }

        var totalBytes = references.Values.Sum(reference => (long)reference.ByteLength);
        if (references.Count > 128 || totalBytes > 40_000_000) return Error("media-limits-exceeded", 413);

        using var client = clients.CreateClient();
        foreach (var reference in references.Values)
        {
            var uri = new Uri(projectUrl.TrimEnd('/') + "/storage/v1/object/published-media/" +
                ownerId.ToString("D") + "/" + reference.Id);
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation("apikey", apiKey);
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await SendAsync(client, request, cancellationToken);
            if ((int)response.StatusCode == 404) return Error("media-not-uploaded", 422);
            if (!response.IsSuccessStatusCode) return Error("media-storage-unavailable", 502);

            byte[]? bytes;
            try
            {
                var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                bytes = await ReadBoundedBodyAsync(stream, reference.ByteLength, cancellationToken);
            }
            catch (IOException) { return Error("media-storage-unavailable", 502); }
            if (bytes is null || !ValidMediaAsset(reference, bytes)) return Error("media-integrity-failed", 422);
        }
        return null;
    }

    private static bool RequiresReuseConfirmation(JsonElement content, string? license) =>
        string.IsNullOrWhiteSpace(license) ||
        !content.TryGetProperty("licence", out var originalLicense) || originalLicense.ValueKind != JsonValueKind.String ||
        !string.Equals(originalLicense.GetString(), license, StringComparison.Ordinal) ||
        OptionalJsonString(content, "sourceId") is { Length: > 0 } || OptionalJsonString(content, "forkedFromVersionId") is { Length: > 0 } ||
        content.TryGetProperty("cards", out var cards) && cards.ValueKind == JsonValueKind.Array &&
        cards.EnumerateArray().Any(card => OptionalJsonString(card, "origin") == "imported");

    private static JsonElement JsonNodeFrom(JsonElement source, string? license, string? attribution)
    {
        using var parsed = JsonDocument.Parse(source.GetRawText());
        var node = System.Text.Json.Nodes.JsonNode.Parse(parsed.RootElement.GetRawText())!.AsObject();
        node["licence"] = license;
        node["attribution"] = attribution;
        using var normalized = JsonDocument.Parse(node.ToJsonString());
        return normalized.RootElement.Clone();
    }

    private static Guid DerivePublicationId(Guid ownerId, Guid sourceAreaId, Guid operationId)
    {
        var input = JsonSerializer.Serialize(new[] { "recall-publication-operation-v1", ownerId.ToString("D").ToLowerInvariant(), sourceAreaId.ToString("D").ToLowerInvariant(), operationId.ToString("D").ToLowerInvariant() }, CanonicalJsonOptions);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();
        var variant = (8 + (Convert.ToInt32(hash[16].ToString(), 16) & 3)).ToString("x");
        var id = $"{hash[..8]}-{hash[8..12]}-5{hash[13..16]}-{variant}{hash[17..20]}-{hash[20..32]}";
        return Guid.Parse(id);
    }

    private static string PublicationFingerprint(Guid sourceAreaId, JsonElement content, string visibility, string? attribution, string? license, string? forkedFrom)
    {
        var value = JsonSerializer.SerializeToElement(new
        {
            sourceAreaId = sourceAreaId.ToString("D").ToLowerInvariant(),
            content,
            visibility,
            attribution,
            license,
            forkedFromVersionId = forkedFrom
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(value)))).ToLowerInvariant();
    }

    private static object PublishResponse(Guid operationId, Guid versionId, Guid sourceAreaId, string visibility, Publication publication, string? token)
    {
        var response = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1,
            ["operationId"] = operationId.ToString("D").ToLowerInvariant(),
            ["version"] = new
            {
                id = versionId.ToString("D").ToLowerInvariant(),
                sourceAreaId = sourceAreaId.ToString("D").ToLowerInvariant(),
                version = publication.Version,
                content = publication.Content,
                contentHash = publication.ContentHash,
                visibility,
                attribution = publication.Attribution,
                license = publication.License,
                forkedFromVersionId = publication.ForkedFromVersionId,
                createdAt = publication.CreatedAt
            }
        };
        if (token is not null) response["shareToken"] = token;
        return response;
    }
}
