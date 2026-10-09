using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Recall.Api.Features.RateLimits;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Publishing;

/// <summary>HTTP routes for immutable publication reads and owner share-token management.</summary>
public static partial class PublishingEndpoints
{
    private static readonly JsonSerializerOptions CanonicalJsonOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static IEndpointRouteBuilder MapPublishingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/knowledge-areas", CreatePublicationAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PublicationWrite, "publication-write", Publication: true)).WithPublicationResponseHeaders();
        endpoints.MapGet("/api/v1/published/{versionId}", ReadPublishedAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PublicPublicationRead, Anonymous: true, Publication: true)).WithPublicationResponseHeaders();
        endpoints.MapGet("/api/v1/published/{versionId}/updates", ReadUpdatesAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PublicPublicationRead, Anonymous: true, Publication: true)).WithPublicationResponseHeaders();
        endpoints.MapGet("/api/v1/published/{versionId}/media/{mediaId}", ReadPublishedMediaAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PublicPublicationRead, Anonymous: true, Publication: true)).WithPublicationResponseHeaders();
        endpoints.MapPatch("/api/v1/published/{versionId}/token", ManageTokenAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PublicationWrite, "publication-write", Publication: true)).WithPublicationResponseHeaders();
        endpoints.MapPost("/api/v1/published/{versionId}/fork", ForkPublishedAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PublicationWrite, "publication-write", Publication: true)).WithPublicationResponseHeaders();
        endpoints.MapPost("/api/v1/publishing/media/{mediaId}", UploadPublishedMediaAsync).AllowAnonymous()
            .WithMetadata(new ApiRateLimitMetadata(ApiRateLimitScope.PrivateMediaWrite, "media-write", Publication: true)).WithPublicationResponseHeaders();
        return endpoints;
    }

    private static RouteHandlerBuilder WithPublicationResponseHeaders(this RouteHandlerBuilder builder) =>
        builder.AddEndpointFilter(async (filterContext, next) =>
        {
            var result = await next(filterContext);
            var headers = filterContext.HttpContext.Response.Headers;
            if (string.IsNullOrWhiteSpace(headers.CacheControl)) headers.CacheControl = "private, no-store, max-age=0";
            if (headers.CacheControl.ToString().StartsWith("private", StringComparison.OrdinalIgnoreCase))
            {
                var vary = headers["Vary"].ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
                vary.Add("Authorization");
                vary.Add("Cookie");
                headers["Vary"] = string.Join(", ", vary);
            }
            return result;
        });

    private static async Task<IResult> ReadPublishedAsync(
        HttpContext context,
        string versionId,
        IHttpClientFactory clients,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (!TryGuid(versionId, out var parsedId))
            return Error("publication-not-found", 404);
        if (!TryConfiguration(configuration, out var projectUrl, out var key))
            return Error("publication-unavailable", 503);

        var tokenValues = context.Request.Query["token"];
        var token = tokenValues.Count == 1 ? tokenValues.ToString() : null;
        if ((tokenValues.Count > 1) || (token is not null && !ValidShareToken(token)))
            return Error("publication-not-found", 404);
        if (token is null)
        {
            var auth = context.Request.Headers.Authorization.ToString();
            if (auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var candidate = auth[7..].Trim();
                if (ValidShareToken(candidate)) token = candidate;
            }
        }

        using var client = clients.CreateClient();
        using var response = token is null
            ? await GetAsync(client, projectUrl, key,
                $"published_knowledge_area_versions?select=id,version,content,content_hash,attribution,license,forked_from_version_id,created_at,visibility&id=eq.{parsedId:D}&visibility=eq.public&limit=1",
                null, cancellationToken)
            : await PostRpcAsync(client, projectUrl, key, "read_unlisted_knowledge_area_version",
                new { p_version_id = parsedId, p_share_token_hash = Hash(token) }, cancellationToken);

        if (!response.IsSuccessStatusCode) return Error("publication-not-found", 404);
        using var document = await ParseJsonAsync(response, cancellationToken);
        if (document is null) return Error("publication-not-found", 404);
        var row = FirstRow(document.RootElement);
        if (row is null || !TryValidatePublication(row.Value, parsedId, out var published))
            return Error("publication-not-found", 404);
        var body = new
        {
            schemaVersion = 1,
            version = new
            {
                id = parsedId.ToString("D").ToLowerInvariant(),
                version = published.Version,
                content = published.Content,
                contentHash = published.ContentHash,
                attribution = published.Attribution,
                license = published.License,
                forkedFromVersionId = published.ForkedFromVersionId,
                createdAt = published.CreatedAt
            }
        };
        context.Response.Headers.CacheControl = token is null ? "public, max-age=60" : "private, no-store";
        return Results.Json(body);
    }

    private static async Task<IResult> ReadUpdatesAsync(
        HttpContext context,
        string versionId,
        IHttpClientFactory clients,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (!TryGuid(versionId, out var parsedId))
            return Error("invalid-request", 400);
        var query = context.Request.Query;
        if (query.Keys.Any(key => key is not ("sourceAreaId" or "token")) ||
            query.Any(pair => pair.Value.Count != 1)) return Error("invalid-request", 400);
        var assertedSource = query.TryGetValue("sourceAreaId", out var sourceValue) ? sourceValue.ToString() : null;
        if (assertedSource is not null && !TryGuid(assertedSource, out _))
            return Error("invalid-request", 400);
        var token = query.TryGetValue("token", out var tokenValue) ? tokenValue.ToString() : null;
        if (token is not null && !ValidShareToken(token)) return Error("invalid-request", 400);
        if (!TryConfiguration(configuration, out var projectUrl, out var key))
            return Error("publication-unavailable", 503);

        using var client = clients.CreateClient();
        using var baselineResponse = token is null
            ? await GetAsync(client, projectUrl, key,
                $"published_knowledge_area_versions?select=id,source_area_id,owner_id,version,content,content_hash,visibility,created_at&id=eq.{parsedId:D}&visibility=eq.public&limit=1",
                null, cancellationToken)
            : await PostRpcAsync(client, projectUrl, key, "read_unlisted_knowledge_area_version",
                new { p_version_id = parsedId, p_share_token_hash = Hash(token) }, cancellationToken);
        if (!baselineResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var baselineJson = await ParseJsonAsync(baselineResponse, cancellationToken);
        var baseline = baselineJson is null ? null : FirstRow(baselineJson.RootElement);
        if (baseline is null || !TryValidatePublication(baseline.Value, parsedId, out var known))
            return Error("publication-not-found", 404);
        Guid sourceId;
        if (baseline.Value.TryGetProperty("source_area_id", out var sourceAreaValue) && sourceAreaValue.ValueKind != JsonValueKind.Null)
        {
            if (!TryGuid(baseline.Value, "source_area_id", out sourceId)) return Error("publication-not-found", 404);
        }
        else if (!TryGuid(known.Content, "id", out sourceId))
            return Error("publication-not-found", 404);
        if (!TryGuid(known.Content, "id", out var documentSourceId) || documentSourceId != sourceId)
            return Error("publication-not-found", 404);
        Guid? ownerId;
        if (token is null)
        {
            ownerId = TryGuid(baseline.Value, "owner_id", out var publicOwner) ? publicOwner : null;
        }
        else
        {
            using var ownerResponse = await PostRpcAsync(client, projectUrl, key, "read_unlisted_knowledge_area_version_for_media",
                new { p_version_id = parsedId, p_share_token_hash = Hash(token) }, cancellationToken);
            if (!ownerResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
            using var ownerJson = await ParseJsonAsync(ownerResponse, cancellationToken);
            var ownerRow = ownerJson is null ? null : FirstRow(ownerJson.RootElement);
            if (ownerRow is null) return Error("publication-not-found", 404);
            ownerId = TryGuid(ownerRow.Value, "owner_id", out var privateOwner) ? privateOwner : null;
        }
        if (
            !StringEquals(assertedSource, sourceId.ToString("D"), allowNull: true))
            return Error("publication-not-found", 404);

        object? latest = null;
        if (ownerId is { } publisherId)
        {
            var candidateQuery = $"published_knowledge_area_versions?select=id,source_area_id,owner_id,version,content,content_hash,visibility,created_at&owner_id=eq.{publisherId:D}&source_area_id=eq.{sourceId:D}&visibility=eq.public&version=gt.{known.Version}&order=version.desc&limit=1";
            using var candidateResponse = await GetAsync(client, projectUrl, key, candidateQuery, null, cancellationToken);
            if (!candidateResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
            using var candidateJson = await ParseJsonAsync(candidateResponse, cancellationToken);
            var candidateElement = candidateJson is null ? null : FirstRow(candidateJson.RootElement);
            if (candidateElement is { } candidate)
            {
                if (!TryValidatePublication(candidate, null, out var newer) ||
                    !TryGuid(candidate, "source_area_id", out var newerSource) || newerSource != sourceId ||
                    !TryGuid(candidate, "owner_id", out var newerOwner) || newerOwner != publisherId ||
                    !TryGuid(candidate, "id", out var newerId) || newerId == parsedId || newer.Version <= known.Version ||
                    !TryString(candidate, "created_at", out var createdAt))
                    return Error("publication-response-invalid", 502);
                latest = new
                {
                    id = newerId.ToString("D").ToLowerInvariant(),
                    version = newer.Version,
                    sourceAreaId = sourceId.ToString("D").ToLowerInvariant(),
                    createdAt
                };
            }
        }

        context.Response.Headers.CacheControl = "private, no-store";
        return Results.Json(new
        {
            schemaVersion = 1,
            knownVersion = new { id = parsedId.ToString("D").ToLowerInvariant(), version = known.Version, sourceAreaId = sourceId.ToString("D").ToLowerInvariant() },
            latestPublicVersion = latest
        });
    }

    private static async Task<IResult> ManageTokenAsync(
        HttpContext context,
        string versionId,
        IHttpClientFactory clients,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (!TryGuid(versionId, out var parsedId))
            return Error("publication-not-found", 404);
        var principal = await AuthenticateBearerAsync(context);
        var identity = principal is null ? null : SupabaseUserIdentity.TryResolve(principal);
        var bearer = context.Request.Headers.Authorization.ToString();
        if (identity is null || !bearer.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var projectUrl, out var key))
            return Error("publication-unavailable", 503);
        JsonDocument? body = null;
        try
        {
            if (context.Request.ContentLength is > 4_096) return Error("request-too-large", 413);
            var bytes = await ReadBoundedBodyAsync(context.Request.Body, 4_096, cancellationToken);
            if (bytes is null) return Error("request-too-large", 413);
            if (context.Request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) != true)
                return Error("invalid-request", 400);
            body = JsonDocument.Parse(bytes);
            if (body.RootElement.ValueKind != JsonValueKind.Object ||
                !body.RootElement.TryGetProperty("schemaVersion", out var schemaVersion) || schemaVersion.ValueKind != JsonValueKind.Number ||
                !schemaVersion.TryGetInt32(out var version) || version != 1 ||
                !body.RootElement.TryGetProperty("action", out var actionElement) || actionElement.ValueKind != JsonValueKind.String)
                return Error("invalid-request", 400);
            var action = actionElement.GetString();
            if (action is not ("rotate" or "revoke")) return Error("invalid-request", 400);
            var rawToken = action == "rotate" ? NewToken() : null;
            using var client = clients.CreateClient();
            using var response = await PostRpcAsync(client, projectUrl, key, "manage_unlisted_knowledge_area_share_token",
                new { p_version_id = parsedId, p_action = action, p_share_token_hash = rawToken is null ? null : Hash(rawToken) },
                cancellationToken, bearer[7..].Trim());
            if (!response.IsSuccessStatusCode) return Error("share-token-update-failed", 502);
            using var resultJson = await ParseJsonAsync(response, cancellationToken);
            if (resultJson is null || resultJson.RootElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return Error("share-token-update-failed", 502);
            if (!resultJson.RootElement.GetBoolean()) return Error("publication-not-found", 404);
            context.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { schemaVersion = 1, versionId = parsedId.ToString("D").ToLowerInvariant(), token = rawToken });
        }
        catch (JsonException) { return Error("invalid-request", 400); }
        catch (IOException) { return Error("invalid-request", 400); }
        finally { body?.Dispose(); }
    }

    private static async Task<HttpResponseMessage> GetAsync(HttpClient client, string projectUrl, string key,
        string path, string? bearer, CancellationToken cancellationToken)
    {
        using var request = BuildRequest(HttpMethod.Get, projectUrl, key, path, bearer);
        return await SendAsync(client, request, cancellationToken);
    }

    private static async Task<HttpResponseMessage> PostRpcAsync(HttpClient client, string projectUrl, string key,
        string function, object body, CancellationToken cancellationToken, string? bearer = null)
    {
        using var request = BuildRequest(HttpMethod.Post, projectUrl, key, "rpc/" + function, bearer);
        request.Content = JsonContent.Create(body);
        return await SendAsync(client, request, cancellationToken);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpRequestMessage request, CancellationToken cancellationToken)
    {
        try { return await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken); }
        catch (HttpRequestException) { return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable); }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        { return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable); }
    }

    private static HttpRequestMessage BuildRequest(HttpMethod method, string projectUrl, string key, string path, string? bearer)
    {
        var request = new HttpRequestMessage(method, new Uri(new Uri(projectUrl.TrimEnd('/') + "/"), "rest/v1/" + path));
        request.Headers.TryAddWithoutValidation("apikey", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", string.IsNullOrWhiteSpace(bearer) ? key : bearer);
        return request;
    }

    private static bool TryConfiguration(IConfiguration configuration, out string projectUrl, out string key)
    {
        projectUrl = configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"] ?? string.Empty;
        key = configuration["SUPABASE_PUBLISHABLE_KEY"] ?? configuration["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? string.Empty;
        return Uri.TryCreate(projectUrl, UriKind.Absolute, out var uri) &&
               (uri.Scheme == Uri.UriSchemeHttps || uri.Host == "localhost") && !string.IsNullOrWhiteSpace(key);
    }

    private static async Task<JsonDocument?> ParseJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            return await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private static JsonElement? FirstRow(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Array when value.GetArrayLength() > 0 => value[0],
        JsonValueKind.Object => value,
        _ => null
    };

    private sealed record Publication(int Version, JsonElement Content, string ContentHash,
        string? Attribution, string? License, string? ForkedFromVersionId, string CreatedAt);

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
        publication = new Publication(version, normalizedContent.Value, contentHash.ToLowerInvariant(), attribution, license, forked, createdAt);
        return true;
    }

    private static JsonElement? NormalizeKnowledgeArea(JsonElement value)
    {
        try
        {
            if (value.ValueKind != JsonValueKind.Object) return null;
            var document = JsonNode.Parse(value.GetRawText())?.AsObject();
            if (document is null) return null;
            KeepOnly(document, "schemaVersion", "id", "sourceId", "title", "description", "language", "objectives", "ai", "cards", "tags", "licence", "attribution", "forkedFromVersionId");
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
                        KeepOnly(card, "kind", "id", "front", "back", "objectiveIds", "media", "tags", "origin", "sourceId");
                    else
                        KeepOnly(card, "kind", "id", "text", "deletionIndex", "objectiveIds", "media", "tags", "origin", "sourceId");
                    if (card["media"] is JsonArray media)
                        foreach (var reference in media.OfType<JsonObject>())
                            KeepOnly(reference, "id", "mimeType", "byteLength");
                }
            }
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

    private static bool TryGuid(string value, out Guid result)
    {
        result = Guid.Empty;
        if (value.Length != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-') return false;
        var version = value[14];
        var variant = char.ToLowerInvariant(value[19]);
        return version is >= '1' and <= '8' && variant is '8' or '9' or 'a' or 'b' &&
               Guid.TryParseExact(value, "D", out result) && result != Guid.Empty;
    }

    private static bool StringEquals(string? expected, string actual, bool allowNull) =>
        expected is null ? allowNull : TryGuid(expected, out var expectedGuid) && TryGuid(actual, out var actualGuid) && expectedGuid == actualGuid;

    private static bool ValidShareToken(string token) => token.Length == 43 && token.All(character =>
        character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-');

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
    private static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static IResult Error(string code, int status) => Results.Json(new { schemaVersion = 1, error = code }, statusCode: status);

    private static async Task<System.Security.Claims.ClaimsPrincipal?> AuthenticateBearerAsync(HttpContext context)
    {
        try
        {
            var result = await context.AuthenticateAsync("Bearer");
            return result.Succeeded ? result.Principal : null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }
}
