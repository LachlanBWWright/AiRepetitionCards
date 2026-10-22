using System.Text.Json;
using System.Text.Json.Nodes;
namespace Recall.Api.Features.Sync;
internal static partial class SyncHandlers
{
    public static async Task<IResult> StudyPages(HttpContext context, IHttpClientFactory clients, IConfiguration config, CancellationToken ct)
    {
        var auth = await SyncRequestContext.Create(context, config, ct);
        if (auth.Error is not null) return auth.Error;
        object payload;
        var rpc = "read_workspace_study_page";
        if (context.Request.Method == "GET")
        {
            if (!long.TryParse(context.Request.Query["after"].FirstOrDefault() ?? "0", out var after) || after < 0 || after > 9007199254740991) return Error("invalid-request", 400);
            payload = new { p_after = after, p_limit = 5000 };
        }
        else
        {
            var read = await ReadJson(context.Request, 5_000_000, ct);
            if (!read.Ok || read.Value is not JsonObject body || IntegerNode(body["revision"]) is not { } revision || revision < 0 || body["document"] is not JsonObject document || !ValidStudyDocument(document)) return Error("invalid-request", read.TooLarge ? 413 : 400);
            if (new[] { "adjustments", "corrections", "undoStates", "importedSchedules" }.Sum(field => (document[field] as JsonArray)?.Count ?? 0) > 5000) return Error("invalid-request", 400);
            payload = new { p_revision = revision, p_document = document };
            rpc = "sync_workspace_study_batch";
        }
        using var response = await Rpc(auth.Value!, clients, rpc, payload, ct);
        if (response is null || !response.IsSuccessStatusCode) return Error("study-storage-unavailable", 502);
        try
        {
            var result = await JsonNode.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (result is null) return Error("study-conflict", 409);
            if (result is not JsonObject reply || IntegerNode(reply["revision"]) is not >= 0) return Error("invalid-study-response", 502);
            if (context.Request.Method == "GET" && (reply["document"] is not JsonObject doc || !ValidStudyDocument(doc) || reply["nextCursor"] is not null && (reply["nextCursor"] is not JsonValue value || !value.TryGetValue<long>(out var cursor) || cursor < 0 || cursor > 9007199254740991))) return Error("invalid-study-response", 502);
            return Results.Json(reply);
        }
        catch (JsonException) { return Error("invalid-study-response", 502); }
        catch (IOException) { return Error("study-storage-unavailable", 502); }
    }
}
