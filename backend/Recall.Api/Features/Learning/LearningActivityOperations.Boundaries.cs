using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Net.Http.Json;

namespace Recall.Api.Features.Learning;

public sealed partial class LearningActivityOperations
{
    private async Task<Snapshot?> ReadSnapshotAsync(SupabaseApiRequestContext context, CancellationToken token)
    {
        var result = await SendAsync(HttpMethod.Post, new Uri(context.ProjectUrl, "rest/v1/rpc/read_learning_activities"), context.PublishableKey, context.AccessToken, JsonSerializer.SerializeToElement(new { }, JsonOptions), token);
        return result is { } value && TrySnapshot(value, out Snapshot snapshot) ? snapshot : null;
    }

    private async Task<JsonElement?> PostUserRpcAsync(SupabaseApiRequestContext context, string name, JsonElement body, CancellationToken token) =>
        await SendAsync(HttpMethod.Post, new Uri(context.ProjectUrl, "rest/v1/rpc/" + name), context.PublishableKey, context.AccessToken, body, token);

    private async Task<JsonElement?> ReadCanonicalAreaAsync(SupabaseApiRequestContext context, string areaId, CancellationToken token)
    {
        var rows = await GetRowsAsync(context, $"knowledge_areas?select=id&id=eq.{Uri.EscapeDataString(areaId)}&owner_id=eq.{context.UserId:D}&deleted_at=is.null&limit=1", token);
        if (rows is null || rows.Value.ValueKind != JsonValueKind.Array || rows.Value.GetArrayLength() != 1) return null;
        var versions = await GetRowsAsync(context, $"knowledge_area_versions?select=content&knowledge_area_id=eq.{Uri.EscapeDataString(areaId)}&order=version.desc&limit=1", token);
        if (versions is null || versions.Value.ValueKind != JsonValueKind.Array || versions.Value.GetArrayLength() != 1 ||
            !versions.Value[0].TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Object ||
            !content.TryGetProperty("id", out var contentId) || contentId.GetString() != areaId ||
            !content.TryGetProperty("objectives", out var objectives) || objectives.ValueKind != JsonValueKind.Array || objectives.GetArrayLength() > 200 ||
            Encoding.UTF8.GetByteCount(content.GetRawText()) > 500_000 || !String(content, "title", 80, 1) || !String(content, "language", 100, 1) ||
            objectives.EnumerateArray().Any(objective => objective.ValueKind != JsonValueKind.Object || !String(objective, "id", 200, 1) || !String(objective, "title", 500, 1))) return null;
        return content.Clone();
    }

    private static JsonElement BuildAssessmentArea(JsonElement canonical, JsonElement activity, string objectiveId)
    {
        var area = JsonNode.Parse(canonical.GetRawText())?.AsObject() ?? new JsonObject();
        area["cards"] = new JsonArray();
        JsonNode objective = canonical.GetProperty("objectives").EnumerateArray()
            .FirstOrDefault(item => item.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String && id.GetString() == objectiveId) is { ValueKind: JsonValueKind.Object } match
            ? JsonNode.Parse(match.GetRawText())!
            : JsonSerializer.SerializeToNode(new
            {
                id = objectiveId,
                title = activity.GetProperty("title").GetString(),
                description = activity.GetProperty("fallback").GetString() is { Length: > 2000 } fallback ? fallback[..2000] : activity.GetProperty("fallback").GetString(),
                prerequisiteIds = Array.Empty<string>()
            })!;
        area["objectives"] = new JsonArray(objective);
        return JsonSerializer.SerializeToElement(area, JsonOptions);
    }

    private async Task<JsonElement?> GetRowsAsync(SupabaseApiRequestContext context, string path, CancellationToken token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(context.ProjectUrl, "rest/v1/" + path));
        request.Headers.TryAddWithoutValidation("apikey", context.PublishableKey);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
            return document.RootElement.Clone();
        }
        catch (HttpRequestException) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return null; }
    }

    private async Task<Resolved> ResolveAsync(HttpContext http, CancellationToken token)
    {
        var resolved = await SupabaseApiRequestContext.ResolveAsync(http, configuration);
        if (resolved is not SupabaseApiRequestResult.Authenticated authenticated)
            return new Resolved(null, Error(resolved is SupabaseApiRequestResult.Unavailable ? "auth-unavailable" : "unauthenticated", resolved is SupabaseApiRequestResult.Unavailable ? 503 : 401));
        if (http.Request.Headers.TryGetValue("x-recall-owner", out var owners) && (owners.Count != 1 || owners[0] != authenticated.Context.UserId.ToString("D")))
            return new Resolved(null, Error("account-changed", 401));
        return new Resolved(authenticated.Context, null);
    }

    private async Task<JsonElement?> SendAsync(HttpMethod method, Uri uri, string apiKey, string bearer, JsonElement body, CancellationToken token)
    {
        using var request = new HttpRequestMessage(method, uri);
        request.Headers.TryAddWithoutValidation("apikey", apiKey);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Content = JsonContent.Create(body, options: JsonOptions);
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: token);
            return document.RootElement.Clone();
        }
        catch (HttpRequestException) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return null; }
    }

    private async Task<JsonElement?> PostJsonAsync(Uri uri, string apiKey, string bearer, JsonElement body, CancellationToken token) => await SendAsync(HttpMethod.Post, uri, apiKey, bearer, body, token);

    private bool TryProjectUrl(out Uri project)
    {
        var raw = configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"];
        return Uri.TryCreate(raw, UriKind.Absolute, out project!) && (project.Scheme == Uri.UriSchemeHttps || project.Host is "localhost" or "127.0.0.1" or "::1");
    }

    private string? ConfiguredModel(string taskKey)
    {
        var model = configuration[taskKey];
        return string.IsNullOrEmpty(model) ? configuration["OPENAI_MODEL"] : model;
    }

    private bool ValidConfiguredModel(string? model) => !string.IsNullOrWhiteSpace(configuration["OPENAI_API_KEY"]) &&
        !string.IsNullOrWhiteSpace(model) && model.Length <= 120 && model.Trim() == model && !model.Any(char.IsWhiteSpace);

    private static async Task<byte[]?> ReadBodyAsync(HttpContext http, int limit, CancellationToken token)
    {
        if (http.Request.ContentLength is > 0 && http.Request.ContentLength > limit) return null;
        using var output = new MemoryStream();
        var buffer = new byte[16_384];
        while (true)
        {
            var count = await http.Request.Body.ReadAsync(buffer, token);
            if (count == 0) break;
            if (output.Length + count > limit) return null;
            output.Write(buffer, 0, count);
        }
        return output.ToArray();
    }

    private static bool TrySnapshot(byte[] bytes, out Snapshot snapshot)
    {
        snapshot = default;
        try
        {
            using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 40 });
            return TrySnapshot(doc.RootElement, out snapshot);
        }
        catch (JsonException) { return false; }
    }

    private static bool TrySnapshot(JsonElement root, out Snapshot snapshot)
    {
        snapshot = default;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("revision", out var revision) || revision.ValueKind != JsonValueKind.Number || !revision.TryGetInt64(out var rev) || rev < 0 ||
            !root.TryGetProperty("library", out var library) || !ValidLibrary(library)) return false;
        snapshot = new Snapshot(rev, library.Clone());
        return true;
    }

    private static bool ValidLibrary(JsonElement library)
    {
        if (library.ValueKind != JsonValueKind.Object || !library.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var versionNumber) || versionNumber != 1 ||
            !ArrayWithin(library, "activities", 500) || !ArrayWithin(library, "attempts", 10_000) ||
            !ArrayWithinOptional(library, "drafts", 500) || !ArrayWithinOptional(library, "editorDrafts", 500) ||
            Encoding.UTF8.GetByteCount(library.GetRawText()) > MaximumLibraryBytes || !BoundedJson(library)) return false;
        foreach (var name in new[] { "activities", "attempts", "drafts", "editorDrafts" })
            if (library.TryGetProperty(name, out var array) && array.ValueKind == JsonValueKind.Array && array.EnumerateArray().Any(entry => !ValidStoredEntry(name, entry))) return false;
        foreach (var collection in new[] { "activities", "attempts", "drafts", "editorDrafts" })
        {
            var ids = new HashSet<string>(StringComparer.Ordinal);
            if (library.TryGetProperty(collection, out var entries))
                foreach (var entry in entries.EnumerateArray()) if (!ids.Add(entry.GetProperty("id").GetString()!)) return false;
        }
        return true;
    }

    private static bool ValidStoredEntry(string collection, JsonElement entry) => collection switch
    {
        "activities" => ValidActivity(entry),
        "attempts" => ValidAttempt(entry),
        "drafts" => ValidDraft(entry),
        "editorDrafts" => ValidEditorDraft(entry),
        _ => false
    };

    private static bool ValidAttempt(JsonElement entry)
    {
        if (entry.ValueKind != JsonValueKind.Object || !String(entry, "id", 200, 1) || !entry.TryGetProperty("activity", out var activity) || !ValidActivity(activity) ||
            !entry.TryGetProperty("response", out var response) || !ValidResponse(response) || !entry.TryGetProperty("result", out var result) || !ValidResult(result) ||
            !TryTime(entry, "startedAt", out var started) || !TryTime(entry, "submittedAt", out var submitted) || !TryTime(entry, "acceptedAt", out var accepted) ||
            started > submitted || submitted > accepted || !result.TryGetProperty("evidence", out var evidence)) return false;
        var objectiveIds = activity.GetProperty("objectiveIds").EnumerateArray().Select(value => value.GetString()).ToHashSet(StringComparer.Ordinal);
        var assistance = response.GetProperty("assistance").GetString();
        var uniqueEvidence = new HashSet<string>(StringComparer.Ordinal);
        return evidence.EnumerateArray().All(item => item.TryGetProperty("objectiveId", out var objective) && objective.ValueKind == JsonValueKind.String && objectiveIds.Contains(objective.GetString()) &&
            item.TryGetProperty("assistance", out var itemAssistance) && itemAssistance.GetString() == assistance && item.TryGetProperty("dimension", out var dimension) && dimension.ValueKind == JsonValueKind.String &&
            uniqueEvidence.Add(objective.GetString() + ":" + dimension.GetString()));
    }

    private static bool ValidDraft(JsonElement entry) => entry.ValueKind == JsonValueKind.Object && String(entry, "id", 200, 1) &&
        entry.TryGetProperty("activity", out var activity) && ValidActivity(activity) && entry.TryGetProperty("response", out var response) && ValidResponse(response) &&
        entry.TryGetProperty("stage", out var stage) && stage.ValueKind == JsonValueKind.Number && stage.TryGetInt32(out var stageValue) && stageValue is >= 0 and <= 9 &&
        TryTime(entry, "startedAt", out var started) && TryTime(entry, "updatedAt", out var updated) && started <= updated;

    private static bool ValidEditorDraft(JsonElement entry)
    {
        if (entry.ValueKind != JsonValueKind.Object || !String(entry, "id", 200, 1) || !String(entry, "areaId", 200, 1) || !String(entry, "title", 40_000) ||
            !String(entry, "pluginId", 200, 1) || !String(entry, "objectiveId", 200, 1) || !TryTime(entry, "updatedAt", out _) ||
            !entry.TryGetProperty("fields", out var fields) || fields.ValueKind != JsonValueKind.Object || fields.GetRawText().Length > 100_000 ||
            fields.EnumerateObject().Any(field => field.Name.Length > 1000 || field.Value.ValueKind != JsonValueKind.String || field.Value.GetString()!.Length > 100_000)) return false;
        return !entry.TryGetProperty("editing", out var editing) || ValidActivity(editing);
    }

    private static bool TryTime(JsonElement root, string name, out DateTimeOffset time)
    {
        time = default;
        if (!String(root, name, 40, 1) || !DateTimeOffset.TryParse(root.GetProperty(name).GetString(), System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var parsed)) return false;
        var text = root.GetProperty(name).GetString();
        if (text != parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture)) return false;
        time = parsed;
        return true;
    }

    private static bool ValidActivity(JsonElement item) => item.ValueKind == JsonValueKind.Object && String(item, "id", 200, 1) && String(item, "areaId", 200, 1) &&
        String(item, "title", 300, 1) && String(item, "pluginId", 200, 1) && Integer(item, "pluginVersion", 1) && Integer(item, "revision", 1) &&
        item.TryGetProperty("objectiveIds", out var objectives) && objectives.ValueKind == JsonValueKind.Array && objectives.GetArrayLength() is >= 1 and <= 20 &&
        objectives.EnumerateArray().All(x => x.ValueKind == JsonValueKind.String && x.GetString() is { Length: > 0 and <= 200 } value && value.Trim().Length > 0) &&
        objectives.EnumerateArray().Select(x => x.GetString()).Distinct(StringComparer.Ordinal).Count() == objectives.GetArrayLength() && String(item, "fallback", 40_000) &&
        item.TryGetProperty("payload", out var payload) && payload.ValueKind == JsonValueKind.Object && payload.GetRawText().Length <= 100_000 &&
        (!item.TryGetProperty("archived", out var archived) || archived.ValueKind is JsonValueKind.True or JsonValueKind.False);

    private static bool ValidResponse(JsonElement response) => response.ValueKind == JsonValueKind.Object && response.TryGetProperty("answers", out var answers) && answers.ValueKind == JsonValueKind.Array && answers.GetArrayLength() <= 20 && answers.EnumerateArray().All(x => x.ValueKind == JsonValueKind.String && x.GetString()!.Length <= 40_000) &&
        response.TryGetProperty("selectedOptionIds", out var selected) && selected.ValueKind == JsonValueKind.Array && selected.GetArrayLength() <= 20 && selected.EnumerateArray().All(x => x.ValueKind == JsonValueKind.String && x.GetString()!.Length <= 200) &&
        response.TryGetProperty("selfScore", out var score) && Number(score, out var scoreValue) && scoreValue is >= 0 and <= 1 &&
        response.TryGetProperty("assistance", out var assistance) && assistance.ValueKind == JsonValueKind.String && assistance.GetString() is "none" or "hint" or "worked-example" or "answer-revealed" &&
        (!response.TryGetProperty("presentedPrompts", out var prompts) || prompts.ValueKind == JsonValueKind.Array && prompts.GetArrayLength() is >= 1 and <= 10 && prompts.EnumerateArray().All(x => x.ValueKind == JsonValueKind.String && x.GetString()!.Length <= 40_000));

    private static bool ValidSequence(JsonElement activity, JsonElement response, bool adaptive)
    {
        if (!activity.TryGetProperty("payload", out var payload)) return false;
        string[] approvedPrompts;
        if (payload.TryGetProperty("prompts", out var approved) && approved.ValueKind == JsonValueKind.Array)
            approvedPrompts = approved.EnumerateArray().Where(value => value.ValueKind == JsonValueKind.String).Select(value => value.GetString()!).ToArray();
        else if (payload.TryGetProperty("prompt", out var prompt) && prompt.ValueKind == JsonValueKind.String)
            approvedPrompts = [prompt.GetString()!];
        else if (payload.TryGetProperty("front", out var front) && front.ValueKind == JsonValueKind.String)
            approvedPrompts = [front.GetString()!];
        else return false;
        if (approvedPrompts.Length is < 1 or > 10 || approvedPrompts.Any(value => string.IsNullOrWhiteSpace(value) || value.Length > 20_000)) return false;
        var prompts = response.TryGetProperty("presentedPrompts", out var supplied) && supplied.ValueKind == JsonValueKind.Array ? supplied.EnumerateArray().Select(value => value.GetString()).ToArray() : approvedPrompts;
        if (prompts.Length < approvedPrompts.Length || prompts.Length > 10 || (!adaptive && prompts.Length != approvedPrompts.Length) || prompts.Where((value, index) => index < approvedPrompts.Length && value != approvedPrompts[index]).Any() || prompts.Skip(approvedPrompts.Length).Any(value => value is null || value.Length > 2000 || string.IsNullOrWhiteSpace(value))) return false;
        if (!response.TryGetProperty("answers", out var answers) || answers.GetArrayLength() != prompts.Length || answers.EnumerateArray().Any(value => string.IsNullOrWhiteSpace(value.GetString()))) return false;
        return !response.TryGetProperty("selectedOptionIds", out var selected) || selected.ValueKind != JsonValueKind.Array || selected.GetArrayLength() == 0;
    }

    private static bool ValidRubricPayload(JsonElement activity)
    {
        if (!activity.TryGetProperty("payload", out var payload) || !String(payload, "rubric", 20_000, 1) || !String(payload, "reference", 20_000)) return false;
        if (!payload.TryGetProperty("prompts", out var prompts) || prompts.ValueKind != JsonValueKind.Array || prompts.GetArrayLength() is < 1 or > 10) return false;
        return prompts.EnumerateArray().All(prompt => prompt.ValueKind == JsonValueKind.String && prompt.GetString() is { Length: > 0 and <= 20_000 } text && text.Trim().Length > 0);
    }

    private static bool ValidCodingPayload(JsonElement activity)
    {
        if (!activity.TryGetProperty("payload", out var payload) || !String(payload, "rubric", 20_000, 1) || !String(payload, "reference", 20_000) ||
            !payload.TryGetProperty("language", out var language) || language.ValueKind != JsonValueKind.String || language.GetString() != "javascript" ||
            !payload.TryGetProperty("prompts", out var prompts) || prompts.ValueKind != JsonValueKind.Array || prompts.GetArrayLength() is < 1 or > 10 ||
            !payload.TryGetProperty("tests", out var tests) || tests.ValueKind != JsonValueKind.Array || tests.GetArrayLength() is < 1 or > 20) return false;
        return prompts.EnumerateArray().All(prompt => prompt.ValueKind == JsonValueKind.String && prompt.GetString() is { Length: > 0 and <= 20_000 } text && text.Trim().Length > 0) &&
            tests.EnumerateArray().All(test => test.ValueKind == JsonValueKind.Object && test.TryGetProperty("input", out var input) && input.ValueKind == JsonValueKind.Array && input.GetArrayLength() <= 10 && test.TryGetProperty("expected", out _));
    }

    private static bool ValidResult(JsonElement result) => result.ValueKind == JsonValueKind.Object &&
        result.TryGetProperty("evidence", out var evidence) && evidence.ValueKind == JsonValueKind.Array && evidence.GetArrayLength() is >= 1 and <= 100 &&
        evidence.EnumerateArray().All(item => item.ValueKind == JsonValueKind.Object && String(item, "objectiveId", 200, 1) &&
            item.TryGetProperty("dimension", out var dimension) && dimension.ValueKind == JsonValueKind.String && dimension.GetString() is "recall" or "recognition" or "reasoning" or "application" or "transfer" &&
            item.TryGetProperty("score", out var score) && Number(score, out var scoreValue) && scoreValue is >= 0 and <= 1 &&
            item.TryGetProperty("confidence", out var confidence) && Number(confidence, out var confidenceValue) && confidenceValue is >= 0 and <= 1 &&
            item.TryGetProperty("assistance", out var assistance) && assistance.ValueKind == JsonValueKind.String && assistance.GetString() is "none" or "hint" or "worked-example" or "answer-revealed" &&
            item.TryGetProperty("assessment", out var assessment) && assessment.ValueKind == JsonValueKind.String && assessment.GetString() is "self" or "deterministic" or "ai" or "human" &&
            item.TryGetProperty("explanation", out var explanation) && explanation.ValueKind == JsonValueKind.String && explanation.GetString() is { Length: > 0 and <= 4000 }) &&
        String(result, "feedback", 8000, 1) && String(result, "evaluatorId", 200, 1) && String(result, "evaluatorVersion", 200, 1) &&
        (!result.TryGetProperty("suggestedReviewRating", out var rating) || rating.ValueKind == JsonValueKind.String && rating.GetString() is "again" or "hard" or "good" or "easy");

    private static bool AttemptsAreAppendOnly(JsonElement before, JsonElement after)
    {
        var next = after.GetProperty("attempts").EnumerateArray().ToDictionary(item => item.GetProperty("id").GetString()!, item => item.GetRawText(), StringComparer.Ordinal);
        foreach (var oldAttempt in before.GetProperty("attempts").EnumerateArray())
        {
            var id = oldAttempt.GetProperty("id").GetString()!;
            if (!next.TryGetValue(id, out var value) || !JsonNode.DeepEquals(JsonNode.Parse(oldAttempt.GetRawText()), JsonNode.Parse(value))) return false;
        }
        return true;
    }

    private static JsonElement? FindActivity(JsonElement library, string id) => library.GetProperty("activities").EnumerateArray().FirstOrDefault(activity => activity.GetProperty("id").GetString() == id) is { ValueKind: JsonValueKind.Object } found ? found.Clone() : null;
    private static bool ArrayWithin(JsonElement root, string name, int max) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array && value.GetArrayLength() <= max;
    private static bool ArrayWithinOptional(JsonElement root, string name, int max) => !root.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Array && value.GetArrayLength() <= max;
    private static bool String(JsonElement root, string name, int max, int min = 0) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { } text && text.Length >= min && text.Length <= max && (min == 0 || text.Trim().Length > 0);
    private static bool Integer(JsonElement root, string name, int min) => root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) && number >= min;
    private static bool Number(JsonElement value, out double number) { number = 0; return value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out number) && double.IsFinite(number); }
    private static bool TryObject(byte[] bytes, out JsonElement root) { try { using var doc = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 40 }); root = doc.RootElement.Clone(); return root.ValueKind == JsonValueKind.Object; } catch (JsonException) { root = default; return false; } }
    private static bool BoundedJson(JsonElement root)
    {
        var pending = new Stack<(JsonElement Value, int Depth)>(); pending.Push((root, 0)); var count = 0;
        while (pending.TryPop(out var item)) { if (++count > 50_000 || item.Depth > 32) return false; if (item.Value.ValueKind == JsonValueKind.String && item.Value.GetString()!.Length > 100_000) return false; if (item.Value.ValueKind == JsonValueKind.Number && !Number(item.Value, out _)) return false; if (item.Value.ValueKind == JsonValueKind.Array) foreach (var child in item.Value.EnumerateArray()) pending.Push((child, item.Depth + 1)); else if (item.Value.ValueKind == JsonValueKind.Object) foreach (var property in item.Value.EnumerateObject()) { if (property.Name.Length > 1000) return false; pending.Push((property.Value, item.Depth + 1)); } }
        return true;
    }
}
