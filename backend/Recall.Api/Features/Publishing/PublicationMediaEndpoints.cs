using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Publishing;

public static partial class PublishingEndpoints
{
    private const int MaximumPublishedMediaBytes = 20_000_000;

    private static async Task<IResult> UploadPublishedMediaAsync(
        HttpContext context, string mediaId, IHttpClientFactory clients, IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var principal = await AuthenticateBearerAsync(context);
        var identity = principal is null ? null : SupabaseUserIdentity.TryResolve(principal);
        var authorization = context.Request.Headers.Authorization.ToString();
        if (identity is null || !authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return Error("unauthenticated", 401);
        if (!DeckOwnerHeaderMatches(context, identity.UserId)) return Error("unauthenticated", 401);
        if (!ValidMediaId(mediaId)) return Error("invalid-media-reference", 400);
        if (!TryConfiguration(configuration, out var projectUrl, out var key)) return Error("media-unavailable", 503);
        if (context.Request.ContentLength is > MaximumPublishedMediaBytes) return Error("media-too-large", 413);
        if (!context.Request.Headers.TryGetValue("x-recall-media-reference", out var referenceHeader) ||
            referenceHeader.Count != 1) return Error("invalid-media-reference", 400);
        MediaReference? reference;
        try
        {
            using var referenceDocument = JsonDocument.Parse(referenceHeader.ToString());
            if (!TryReadMediaReference(referenceDocument.RootElement, mediaId, out reference)) return Error("invalid-media-reference", 400);
        }
        catch (JsonException) { return Error("invalid-media-reference", 400); }
        if (context.Request.ContentType?.Split(';', 2)[0].Trim().Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase) != true)
            return Error("unsupported-media-type", 415);

        byte[]? bytes;
        try { bytes = await ReadBoundedBodyAsync(context.Request.Body, MaximumPublishedMediaBytes, cancellationToken); }
        catch (IOException) { return Error("media-read-failed", 400); }
        if (bytes is null) return Error("media-too-large", 413);
        if (!ValidMediaAsset(reference!, bytes)) return Error("media-integrity-failed", 422);
        var path = $"object/published-media/{identity.UserId:D}/{mediaId}";
        using var request = BuildRequest(HttpMethod.Post, projectUrl, key, path, authorization[7..].Trim());
        request.Headers.TryAddWithoutValidation("x-upsert", "false");
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(reference!.MimeType);
        using var client = clients.CreateClient();
        using var response = await SendAsync(client, request, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            context.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { reference }, statusCode: 201);
        }
        if (response.StatusCode == System.Net.HttpStatusCode.Conflict)
        {
            context.Response.Headers.CacheControl = "private, no-store";
            return Results.Json(new { reference }, statusCode: 200);
        }
        return Error("media-storage-unavailable", 502);
    }

    private static async Task<IResult> ReadPublishedMediaAsync(
        HttpContext context, string versionId, string mediaId, IHttpClientFactory clients,
        IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(versionId, out var publicationId) || !ValidMediaId(mediaId)) return Error("published-media-not-found", 404);
        var query = context.Request.Query;
        if (query.Keys.Any(key => key != "token") || query.TryGetValue("token", out var tokenValues) && tokenValues.Count != 1)
            return Error("published-media-not-found", 404);
        var token = query.TryGetValue("token", out tokenValues) ? tokenValues.ToString() : null;
        if (token is not null && !ValidShareToken(token)) return Error("published-media-not-found", 404);
        if (!TryConfiguration(configuration, out var projectUrl, out var key)) return Error("media-unavailable", 503);
        var principal = await AuthenticateBearerAsync(context);
        var requester = principal is null ? null : SupabaseUserIdentity.TryResolve(principal)?.UserId;
        if (!DeckOwnerHeaderMatches(context, requester)) return Error("unauthenticated", 401);
        var bearer = context.Request.Headers.Authorization.ToString();
        var accessToken = bearer.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? bearer[7..].Trim() : null;
        using var client = clients.CreateClient();
        using var publicationResponse = await PostRpcAsync(client, projectUrl, key, "read_deck_version_for_media",
            new { p_version_id = publicationId, p_requester_id = requester, p_share_token_hash = token is null ? null : Hash(token) }, cancellationToken, accessToken);
        if (!publicationResponse.IsSuccessStatusCode) return Error("published-media-not-found", 404);
        using var publicationJson = await ParseJsonAsync(publicationResponse, cancellationToken);
        var publication = publicationJson is null ? null : FirstRow(publicationJson.RootElement);
        if (publication is null || !TryGuid(publication.Value, "id", out var returnedId) || returnedId != publicationId ||
            !TryGuid(publication.Value, "owner_id", out var ownerId) ||
            !TryString(publication.Value, "visibility", out var visibility) || visibility is not ("private" or "unlisted" or "public") ||
            !publication.Value.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object ||
            !TryString(publication.Value, "content_hash", out var contentHash))
            return Error("published-media-not-found", 404);
        var normalizedContent = NormalizeKnowledgeArea(content);
        if (normalizedContent is null || !ValidPortableDocument(normalizedContent.Value) ||
            !string.Equals(contentHash, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(normalizedContent.Value)))).ToLowerInvariant(), StringComparison.Ordinal))
            return Error("published-media-not-found", 404);
        var reference = FindMediaReference(normalizedContent.Value, mediaId);
        if (reference is null) return Error("published-media-not-found", 404);

        var storagePath = $"object/authenticated/published-media/{ownerId:D}/{mediaId}";
        using var storageRequest = BuildRequest(HttpMethod.Get, projectUrl, key, storagePath, requester is null ? null : accessToken);
        storageRequest.Headers.TryAddWithoutValidation("x-recall-publication-version-id", publicationId.ToString("D"));
        if (token is not null) storageRequest.Headers.TryAddWithoutValidation("x-recall-share-token-hash", Hash(token));
        using var storageResponse = await SendAsync(client, storageRequest, cancellationToken);
        if (!storageResponse.IsSuccessStatusCode) return Error("published-media-not-found", 404);
        byte[] bytes;
        try { bytes = await storageResponse.Content.ReadAsByteArrayAsync(cancellationToken); }
        catch (IOException) { return Error("media-unavailable", 503); }
        if (!ValidMediaAsset(reference, bytes)) return Error("published-media-not-found", 404);
        context.Response.Headers.CacheControl = requester is null && token is null && visibility == "public"
            ? "public, max-age=300" : "private, no-store";
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Response.Headers["Cross-Origin-Resource-Policy"] = "cross-origin";
        return Results.Bytes(bytes, reference.MimeType);
    }

    private sealed record MediaReference(string Id, string MimeType, int ByteLength);

    private static bool TryReadMediaReference(JsonElement value, string routeId, out MediaReference? reference)
    {
        reference = null;
        if (value.ValueKind != JsonValueKind.Object ||
            !TryString(value, "id", out var id) || id != routeId ||
            !TryString(value, "mimeType", out var mime) || mime is not ("image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav" or "audio/mp4" or "audio/webm") ||
            !value.TryGetProperty("byteLength", out var lengthElement) || !lengthElement.TryGetInt32(out var length) || length <= 0 || length > MaximumPublishedMediaBytes)
            return false;
        reference = new MediaReference(id, mime, length);
        return true;
    }

    private static MediaReference? FindMediaReference(JsonElement content, string mediaId)
    {
        if (content.TryGetProperty("cards", out var cards) && cards.ValueKind == JsonValueKind.Array)
        {
            var reference = FindMediaReferenceInItems(cards, mediaId);
            if (reference is not null) return reference;
        }
        if (content.TryGetProperty("noteLibrary", out var library) && library.ValueKind == JsonValueKind.Object &&
            library.TryGetProperty("notes", out var notes) && notes.ValueKind == JsonValueKind.Array)
            return FindMediaReferenceInItems(notes, mediaId);
        return null;
    }

    private static MediaReference? FindMediaReferenceInItems(JsonElement items, string mediaId)
    {
        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("media", out var media) || media.ValueKind != JsonValueKind.Array) continue;
            foreach (var attachment in media.EnumerateArray())
                if (TryReadMediaReference(attachment, mediaId, out var reference)) return reference;
        }
        return null;
    }

    private static bool ValidMediaId(string value) => value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static bool ValidMediaAsset(MediaReference reference, byte[] bytes)
    {
        if (bytes.Length != reference.ByteLength ||
            !string.Equals(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), reference.Id, StringComparison.Ordinal)) return false;
        return reference.MimeType switch
        {
            "image/jpeg" => bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
            "image/png" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            "image/gif" => bytes.AsSpan().StartsWith(Encoding.ASCII.GetBytes("GIF87a")) || bytes.AsSpan().StartsWith(Encoding.ASCII.GetBytes("GIF89a")),
            "image/webp" => bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP",
            "audio/mp4" => Recall.Api.Contracts.MediaContentSignatures.IsMp4Audio(bytes),
            "audio/webm" => Recall.Api.Contracts.MediaContentSignatures.IsWebmAudio(bytes),
            "audio/wav" => bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WAVE",
            "audio/ogg" => bytes.AsSpan().StartsWith(Encoding.ASCII.GetBytes("OggS")),
            "audio/mpeg" => bytes.AsSpan().StartsWith(Encoding.ASCII.GetBytes("ID3")) || bytes.Length >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0,
            _ => false
        };
    }

    private static async Task<byte[]?> ReadBoundedBodyAsync(Stream stream, int maxBytes, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, cancellationToken);
            if (read == 0) break;
            if (buffer.Length + read > maxBytes) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }
}
