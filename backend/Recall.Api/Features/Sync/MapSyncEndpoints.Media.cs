using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.Sync;

internal static partial class SyncHandlers
{
    public static async Task<IResult> WorkspaceMedia(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken cancellationToken)
    {
        var auth = await SyncRequestContext.Create(context, config, cancellationToken);
        if (auth.Error is not null) return auth.Error;
        var mediaId = context.Request.RouteValues["mediaId"]?.ToString();
        var referenceHeaders = context.Request.Headers["x-recall-media-reference"];
        var reference = referenceHeaders.Count == 1 ? ReadMediaReference(referenceHeaders[0], mediaId) : null;
        if (reference is null) return Error("invalid-media-reference", 400);
        var objectUri = new Uri(auth.Value!.ProjectUrl, "/storage/v1/object/published-media/" + auth.Value.UserId + "/" + mediaId);
        if (HttpMethods.IsGet(context.Request.Method))
        {
            using var get = new HttpRequestMessage(HttpMethod.Get, objectUri); SetStorageHeaders(get, auth.Value);
            using var response = await SendSafelyAsync(clients.CreateClient(), get, cancellationToken);
            if (response is null || !response.IsSuccessStatusCode) return Error("media-not-found", 404);
            byte[] bytes;
            try { bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken); }
            catch (IOException) { return Error("media-not-found", 404); }
            if (!VerifyMedia(reference, bytes)) return Error("media-integrity-failed", 422);
            context.Response.Headers.CacheControl = "private, no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.Bytes(bytes, reference.MimeType, enableRangeProcessing: false);
        }
        if (context.Request.ContentLength is > 20_000_000) return Error("media-too-large", 413);
        if (context.Request.ContentType?.Split(';')[0].Trim().ToLowerInvariant() != "application/octet-stream")
            return Error("unsupported-media-type", 415);
        using var buffer = new MemoryStream(); var chunk = new byte[32_768]; int count;
        while ((count = await context.Request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + count > 20_000_000) return Error("media-too-large", 413);
            await buffer.WriteAsync(chunk.AsMemory(0, count), cancellationToken);
        }
        var bytesToUpload = buffer.ToArray();
        if (!VerifyMedia(reference, bytesToUpload)) return Error("media-integrity-failed", 422);
        using var upload = new HttpRequestMessage(HttpMethod.Post, objectUri); SetStorageHeaders(upload, auth.Value);
        upload.Headers.TryAddWithoutValidation("x-upsert", "false");
        upload.Content = new ByteArrayContent(bytesToUpload); upload.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(reference.MimeType);
        using var uploadResponse = await SendSafelyAsync(clients.CreateClient(), upload, cancellationToken);
        if (uploadResponse is null) return Error("media-storage-unavailable", 502);
        var created = uploadResponse.IsSuccessStatusCode;
        if (!created && (int)uploadResponse.StatusCode == 409)
        {
            using var existingRequest = new HttpRequestMessage(HttpMethod.Get, objectUri); SetStorageHeaders(existingRequest, auth.Value);
            using var existingResponse = await SendSafelyAsync(clients.CreateClient(), existingRequest, cancellationToken);
            if (existingResponse is null || !existingResponse.IsSuccessStatusCode)
                return Error("media-storage-conflict", 409);
            byte[] existingBytes;
            try { existingBytes = await existingResponse.Content.ReadAsByteArrayAsync(cancellationToken); }
            catch (IOException) { return Error("media-storage-conflict", 409); }
            if (!VerifyMedia(reference, existingBytes)) return Error("media-storage-conflict", 409);
        }
        else if (!created) return Error("media-storage-unavailable", 502);
        return Results.Json(new { reference }, statusCode: created ? 201 : 200);
    }

    private static void SetStorageHeaders(HttpRequestMessage request, SyncRequestContext auth)
    {
        request.Headers.TryAddWithoutValidation("apikey", auth.ApiKey);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", auth.AccessToken);
    }

    private sealed record MediaReference(string Id, string MimeType, int ByteLength);

    private static MediaReference? ReadMediaReference(string? raw, string? pathId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(raw) || string.IsNullOrWhiteSpace(pathId)) return null;
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String || id.GetString() != pathId ||
                !root.TryGetProperty("mimeType", out var mime) || mime.ValueKind != JsonValueKind.String ||
                !root.TryGetProperty("byteLength", out var length) || !length.TryGetInt32(out var byteLength) || byteLength is < 1 or > 20_000_000)
                return null;
            var mimeType = mime.GetString()!;
            if (mimeType is not ("image/jpeg" or "image/png" or "image/gif" or "image/webp" or "audio/mpeg" or "audio/ogg" or "audio/wav" or "audio/mp4" or "audio/webm") || !System.Text.RegularExpressions.Regex.IsMatch(pathId, "^[a-f0-9]{64}$")) return null;
            return new MediaReference(pathId, mimeType, byteLength);
        }
        catch (JsonException) { return null; }
    }

    private static bool VerifyMedia(MediaReference reference, byte[] bytes)
    {
        if (bytes.Length != reference.ByteLength || Convert.ToHexStringLower(SHA256.HashData(bytes)) != reference.Id) return false;
        return reference.MimeType switch
        {
            "image/png" => bytes.Length >= 8 && bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
            "image/jpeg" => bytes.Length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff,
            "image/gif" => bytes.Length >= 6 && Encoding.ASCII.GetString(bytes, 0, 6) is "GIF87a" or "GIF89a",
            "image/webp" => bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP",
            "audio/mp4" => Recall.Api.Contracts.MediaContentSignatures.IsMp4Audio(bytes),
            "audio/webm" => Recall.Api.Contracts.MediaContentSignatures.IsWebmAudio(bytes),
            "audio/wav" => bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WAVE",
            "audio/ogg" => bytes.Length >= 4 && Encoding.ASCII.GetString(bytes, 0, 4) == "OggS",
            "audio/mpeg" => bytes.Length >= 3 && Encoding.ASCII.GetString(bytes, 0, 3) == "ID3" || bytes.Length >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0,
            _ => false
        };
    }
}
