using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private static HttpRequestMessage CreateRequest(HttpMethod method, SupabaseApiRequestContext context, string path)
    {
        var request = new HttpRequestMessage(method, new Uri(new Uri(context.ProjectUrl, "/rest/v1/"), path));
        request.Headers.TryAddWithoutValidation("apikey", context.PublishableKey);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    private static bool HasJsonContentType(HttpRequest request) =>
        request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) == true;

    private static async Task<byte[]?> ReadBodyAsync(HttpContext context, int maximumBytes, CancellationToken token)
    {
        if (context.Request.ContentLength is > 0 && context.Request.ContentLength > maximumBytes) return null;
        using var stream = new MemoryStream();
        var buffer = new byte[4_096];
        while (true)
        {
            var count = await context.Request.Body.ReadAsync(buffer, token);
            if (count == 0) break;
            if (stream.Length + count > maximumBytes) return null;
            await stream.WriteAsync(buffer.AsMemory(0, count), token);
        }
        return stream.ToArray();
    }

    private static bool IsProposalContent(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object && TryString(value, "front", out var front) && front.Length is > 0 and <= 1_000 &&
        TryString(value, "back", out var back) && back.Length is > 0 and <= 3_000 &&
        TryString(value, "rationale", out var rationale) && rationale.Length is > 0 and <= 1_000 &&
        value.TryGetProperty("objectiveId", out var objectiveId) &&
        (objectiveId.ValueKind == JsonValueKind.Null || objectiveId.ValueKind == JsonValueKind.String && (objectiveId.GetString()?.Length ?? 0) > 0);

    private static bool TryNormalizeProposalContent(JsonElement value, out JsonElement canonical)
    {
        canonical = default;
        if (!IsProposalContent(value) || !TryNullableString(value, "objectiveId", out var objectiveId) ||
            !TryString(value, "front", out var front) || !TryString(value, "back", out var back) ||
            !TryString(value, "rationale", out var rationale)) return false;
        canonical = JsonSerializer.SerializeToElement(new { front, back, objectiveId, rationale }, JsonOptions);
        return true;
    }

    private static bool SameProposalContent(JsonElement left, JsonElement right) =>
        IsProposalContent(left) && IsProposalContent(right) &&
        TryString(left, "front", out var leftFront) && TryString(right, "front", out var rightFront) && leftFront == rightFront &&
        TryString(left, "back", out var leftBack) && TryString(right, "back", out var rightBack) && leftBack == rightBack &&
        TryNullableString(left, "objectiveId", out var leftObjective) && TryNullableString(right, "objectiveId", out var rightObjective) &&
        leftObjective == rightObjective &&
        TryString(left, "rationale", out var leftRationale) && TryString(right, "rationale", out var rightRationale) && leftRationale == rightRationale;

    private static bool TryUuid(string? value, out Guid result)
    {
        result = Guid.Empty;
        if (value is null || value.Length != 36 || !Guid.TryParseExact(value, "D", out var parsed)) return false;
        var version = value[14];
        var variant = char.ToLowerInvariant(value[19]);
        if (version is < '1' or > '8' || variant is not ('8' or '9' or 'a' or 'b')) return false;
        result = parsed;
        return true;
    }

    private static bool TryString(JsonElement row, string property, out string value)
    {
        value = string.Empty;
        return row.ValueKind == JsonValueKind.Object && row.TryGetProperty(property, out var element) &&
               element.ValueKind == JsonValueKind.String && (value = element.GetString() ?? string.Empty).Length > 0;
    }

    private static void SetPrivateResponseHeaders(HttpContext context)
    {
        context.Response.Headers.CacheControl = "private, no-store, max-age=0";
        context.Response.Headers.Vary = "Authorization, Cookie";
    }

    private static IResult Error(string code, int status) => Results.Json(new { error = code }, statusCode: status);
}
