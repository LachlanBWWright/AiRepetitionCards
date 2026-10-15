using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Recall.Api.Features.RateLimits;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Publishing;

/// <summary>Stable shared-deck discovery, access, subscription, and feedback routes.</summary>
public static partial class PublishingEndpoints
{
    private sealed record DeckSummary(string Id, string Title, string Description, string Language,
        string[] Tags, string AuthorName, string Visibility, string Status, string LatestVersionId,
        int Version, int CardCount, string UpdatedAt, string? License, string? Attribution);

    private static void MapDeckSharingEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/decks", ListDecksAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapGet("/api/v1/decks/mine", ListMyDecksAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapGet("/api/v1/decks/{deckId}", ReadDeckAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapPatch("/api/v1/decks/{deckId}", UpdateDeckAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapGet("/api/v1/deck-subscriptions", ReadSubscriptionsAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapPut("/api/v1/deck-subscriptions", PutSubscriptionAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapDelete("/api/v1/deck-subscriptions/{areaId}", DeleteSubscriptionAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapGet("/api/v1/deck-subscriptions/updates", ReadSubscriptionUpdatesAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapPost("/api/v1/deck-subscriptions/{areaId}/updates/read", ReadSubscriptionUpdateAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapGet("/api/v1/decks/{deckId}/feedback", ReadFeedbackAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapPost("/api/v1/decks/{deckId}/feedback", PostFeedbackAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapPatch("/api/v1/decks/{deckId}/feedback/{feedbackId}", UpdateFeedbackAsync).AllowAnonymous().WithDeckRateLimit(write: true);
    }

    private static RouteHandlerBuilder WithDeckRateLimit(this RouteHandlerBuilder builder, bool write = false) =>
        builder.WithMetadata(write
            ? new ApiRateLimitMetadata(ApiRateLimitScope.PublicationWrite, "publication-write", Publication: true)
            : new ApiRateLimitMetadata(ApiRateLimitScope.PublicPublicationRead, Anonymous: true, Publication: true)).WithPublicationResponseHeaders();

    private static async Task<IResult> ListDecksAsync(HttpContext context, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var query = context.Request.Query;
        if (query.Keys.Any(key => key is not ("q" or "language" or "tag" or "limit" or "cursor")) || query.Any(pair => pair.Value.Count != 1)) return Error("invalid-request", 400);
        var limit = 20;
        if (query.TryGetValue("limit", out var limitValue) && (!int.TryParse(limitValue, out limit) || limit is < 1 or > 50)) return Error("invalid-request", 400);
        Guid? cursor = null;
        if (query.TryGetValue("cursor", out var cursorText)) { if (!TryGuid(cursorText.ToString(), out var parsed)) return Error("invalid-request", 400); cursor = parsed; }
        var search = query.TryGetValue("q", out var searchText) ? searchText.ToString().Trim() : "";
        var language = query.TryGetValue("language", out var languageText) ? languageText.ToString().Trim() : "";
        var tag = query.TryGetValue("tag", out var tagText) ? tagText.ToString().Trim() : "";
        if (search.Length > 120 || language.Length > 40 || tag.Length > 80) return Error("invalid-request", 400);
        var auth = await DeckIdentityAsync(context);
        if (!DeckOwnerHeaderMatches(context, auth?.UserId)) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, key, "list_public_shared_decks",
            new { p_q = search.Length == 0 ? null : search, p_language = language.Length == 0 ? null : language, p_tag = tag.Length == 0 ? null : tag, p_limit = limit + 1, p_cursor = cursor }, cancellationToken, auth?.Token);
        if (!response.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || !TryDeckRows(json.RootElement, out var rows, allowMissingOwner: true)) return Error("publication-response-invalid", 502);
        var hasMore = rows.Length > limit;
        var selected = rows.Take(limit).ToArray();
        return Results.Json(new { schemaVersion = 1, decks = selected.Select(DeckToSummary).ToArray(), nextCursor = hasMore ? selected[^1].Id.ToString("D").ToLowerInvariant() : (string?)null });
    }

    private static async Task<IResult> ListMyDecksAsync(HttpContext context, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return Error("unauthenticated", 401);
        var query = context.Request.Query;
        if (query.Keys.Any(key => key is not ("limit" or "cursor")) || query.Any(pair => pair.Value.Count != 1)) return Error("invalid-request", 400);
        var limit = 20;
        if (query.TryGetValue("limit", out var limitValue) && (!int.TryParse(limitValue, out limit) || limit is < 1 or > 50)) return Error("invalid-request", 400);
        Guid? cursor = null;
        if (query.TryGetValue("cursor", out var cursorText)) { if (!TryGuid(cursorText.ToString(), out var parsed)) return Error("invalid-request", 400); cursor = parsed; }
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, key, "list_owned_shared_decks",
            new { p_owner_id = auth.Value.UserId, p_limit = limit + 1, p_cursor = cursor }, cancellationToken, auth.Value.Token);
        if (!response.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || !TryDeckRows(json.RootElement, out var rows, allowMissingOwner: true)) return Error("publication-response-invalid", 502);
        var hasMore = rows.Length > limit;
        var selected = rows.Take(limit).ToArray();
        return Results.Json(new { schemaVersion = 1, decks = selected.Select(DeckToSummary).ToArray(), nextCursor = hasMore ? selected[^1].Id.ToString("D").ToLowerInvariant() : (string?)null });
    }

    private static async Task<IResult> ReadDeckAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var id)) return Error("deck-not-found", 404);
        var tokenResult = TryDeckToken(context, out var token);
        if (!tokenResult) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context);
        if (!DeckOwnerHeaderMatches(context, auth?.UserId)) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        var reqId = auth?.UserId;
        using var deckResponse = await PostRpcAsync(client, url, key, "read_shared_deck", new { p_deck_id = id, p_requester_id = reqId, p_share_token_hash = token is null ? null : Hash(token) }, cancellationToken, auth?.Token);
        if (!deckResponse.IsSuccessStatusCode) return Error("deck-not-found", 404);
        using var deckJson = await ParseJsonAsync(deckResponse, cancellationToken);
        var deckRow = deckJson is null ? null : FirstRow(deckJson.RootElement);
        if (deckRow is null || !TryDeckRow(deckRow.Value, out var deck, allowMissingOwner: true)) return Error("deck-not-found", 404);
        using var versionsResponse = await PostRpcAsync(client, url, key, "list_deck_versions", new { p_deck_id = id, p_requester_id = reqId, p_share_token_hash = token is null ? null : Hash(token) }, cancellationToken, auth?.Token);
        if (!versionsResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var versionsJson = await ParseJsonAsync(versionsResponse, cancellationToken);
        if (versionsJson is null || !TryVersionRows(versionsJson.RootElement, out var versions)) return Error("publication-response-invalid", 502);
        var canManage = auth?.UserId == deck.OwnerId;
        return Results.Json(new { schemaVersion = 1, deck = DeckToSummary(deck), versions, canManage });
    }

    private static async Task<IResult> UpdateDeckAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var id)) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var body = await ReadDeckJsonAsync(context, 16_384, cancellationToken);
        if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (!ValidateDeckPatch(root)) return Error("invalid-request", 400);
        var patch = new Dictionary<string, object?>();
        AddOptionalString(root, patch, "title", 300);
        AddOptionalString(root, patch, "description", 4000);
        AddOptionalString(root, patch, "language", 40);
        AddOptionalString(root, patch, "authorName", 120, "author_name");
        AddOptionalString(root, patch, "status", 20);
        if (root.TryGetProperty("tags", out var tags)) patch["tags"] = tags.EnumerateArray().Select(item => item.GetString()).ToArray();
        if (patch.Count == 0) return Error("invalid-request", 400);
        using var client = clients.CreateClient();
        const string safeDeckProjection = "deck_id,title,description,language,tags,author_name,visibility,status,latest_version_id,version,card_count,updated_at,license,attribution";
        using var response = await PatchAsync(client, url, key, $"shared_decks?deck_id=eq.{id:D}&select={safeDeckProjection}", patch, auth.Value.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error(response.StatusCode == System.Net.HttpStatusCode.NotFound ? "deck-not-found" : "publication-unavailable", response.StatusCode == System.Net.HttpStatusCode.NotFound ? 404 : 503);
        using var json = await ParseJsonAsync(response, cancellationToken);
        var row = json is null ? null : FirstRow(json.RootElement);
        return row is null || !TryDeckRow(row.Value, out var deck, allowMissingOwner: true) ? Error("deck-not-found", 404) : Results.Json(new { schemaVersion = 1, deck = DeckToSummary(deck) });
    }

    private static async Task<IResult> ReadSubscriptionsAsync(HttpContext context, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var auth = await DeckIdentityAsync(context); if (auth is null) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await GetAsync(client, url, key, $"deck_subscriptions?select=deck_id,area_id,version_id,following&user_id=eq.{auth.Value.UserId:D}&order=area_id.asc", auth.Value.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || json.RootElement.ValueKind != JsonValueKind.Array) return Error("publication-response-invalid", 502);
        var rows = new List<object>();
        foreach (var row in json.RootElement.EnumerateArray())
        {
            if (!TryGuid(row, "deck_id", out var deck) || !TryGuid(row, "area_id", out var area) || !TryGuid(row, "version_id", out var version) || !row.TryGetProperty("following", out var following) || following.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Error("publication-response-invalid", 502);
            rows.Add(new { deckId = deck.ToString("D").ToLowerInvariant(), areaId = area.ToString("D").ToLowerInvariant(), versionId = version.ToString("D").ToLowerInvariant(), following = following.GetBoolean() });
        }
        return Results.Json(new { schemaVersion = 1, subscriptions = rows });
    }

    private static async Task<IResult> PutSubscriptionAsync(HttpContext context, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var auth = await DeckIdentityAsync(context); if (auth is null) return Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 4096, cancellationToken); if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !TryGuid(root, "deckId", out var deck) || !TryGuid(root, "areaId", out var area) || !TryGuid(root, "versionId", out var version) || !root.TryGetProperty("following", out var following) || following.ValueKind is not (JsonValueKind.True or JsonValueKind.False) || root.EnumerateObject().Any(p => p.Name is not ("deckId" or "areaId" or "versionId" or "following"))) return Error("invalid-request", 400);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await UpsertAsync(client, url, key, "deck_subscriptions?on_conflict=user_id,area_id", new { user_id = auth.Value.UserId, deck_id = deck, area_id = area, version_id = version, following = following.GetBoolean() }, auth.Value.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("subscription-invalid", 409);
        return await ReadSubscriptionsAsync(context, clients, configuration, cancellationToken);
    }

    private static async Task<IResult> DeleteSubscriptionAsync(HttpContext context, string areaId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(areaId, out var area)) return Error("invalid-request", 400);
        var auth = await DeckIdentityAsync(context); if (auth is null) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await DeleteAsync(client, url, key, $"deck_subscriptions?area_id=eq.{area:D}&user_id=eq.{auth.Value.UserId:D}", auth.Value.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("subscription-unavailable", 503);
        return await ReadSubscriptionsAsync(context, clients, configuration, cancellationToken);
    }

    private static async Task<IResult> ReadFeedbackAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var deck)) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context);
        if (!DeckOwnerHeaderMatches(context, auth?.UserId)) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await GetAsync(client, url, key, $"deck_feedback?select=id,version_id,card_id,message,kind,status,created_at&deck_id=eq.{deck:D}&order=created_at.asc", auth?.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("deck-not-found", 404);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || json.RootElement.ValueKind != JsonValueKind.Array) return Error("publication-response-invalid", 502);
        var entries = new List<object>();
        foreach (var row in json.RootElement.EnumerateArray())
        {
            if (!TryGuid(row, "id", out var id) || !TryGuid(row, "version_id", out var version) || !TryString(row, "message", out var message) || !TryString(row, "kind", out var kind) || kind is not ("issue" or "suggestion") || !TryString(row, "status", out var status) || status is not ("open" or "resolved") || !TryString(row, "created_at", out var created) || !DateTimeOffset.TryParse(created, out _) || !row.TryGetProperty("card_id", out var card)) return Error("publication-response-invalid", 502);
            var cardId = card.ValueKind == JsonValueKind.Null ? null : card.ValueKind == JsonValueKind.String ? card.GetString() : "!";
            if (cardId == "!") return Error("publication-response-invalid", 502);
            entries.Add(new { id = id.ToString("D").ToLowerInvariant(), versionId = version.ToString("D").ToLowerInvariant(), cardId, message, kind, status, createdAt = created });
        }
        return Results.Json(new { schemaVersion = 1, feedback = entries });
    }

    private static async Task<IResult> PostFeedbackAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var deck)) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context); if (auth is null) return Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 8192, cancellationToken); if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !TryGuid(root, "id", out var id) || !TryGuid(root, "versionId", out var version) || !TryString(root, "message", out var message) || message.Length > 4000 || !TryString(root, "kind", out var kind) || kind is not ("issue" or "suggestion") || !root.TryGetProperty("cardId", out var card) || card.ValueKind is not (JsonValueKind.String or JsonValueKind.Null) || root.EnumerateObject().Any(p => p.Name is not ("id" or "versionId" or "cardId" or "message" or "kind"))) return Error("invalid-request", 400);
        var cardId = card.ValueKind == JsonValueKind.Null ? null : card.GetString();
        if (cardId?.Length > 200) return Error("invalid-request", 400);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await InsertIgnoreDuplicatesAsync(client, url, key, "deck_feedback?on_conflict=id", new { id, user_id = auth.Value.UserId, deck_id = deck, version_id = version, card_id = cardId, message, kind, status = "open" }, auth.Value.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("feedback-invalid", 409);
        using var existingResponse = await PostRpcAsync(client, url, key, "read_my_deck_feedback",
            new { p_id = id }, cancellationToken, auth.Value.Token);
        if (!existingResponse.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var existingJson = await ParseJsonAsync(existingResponse, cancellationToken);
        var existing = existingJson is null ? null : FirstRow(existingJson.RootElement);
        if (existing is null || !TryGuid(existing.Value, "deck_id", out var savedDeck) || savedDeck != deck ||
            !TryGuid(existing.Value, "version_id", out var savedVersion) || savedVersion != version ||
            !TryString(existing.Value, "message", out var savedMessage) || savedMessage != message ||
            !TryString(existing.Value, "kind", out var savedKind) || savedKind != kind ||
            !existing.Value.TryGetProperty("card_id", out var savedCard) ||
            (savedCard.ValueKind == JsonValueKind.Null ? null : savedCard.ValueKind == JsonValueKind.String ? savedCard.GetString() : "!") != cardId)
            return Error("feedback-operation-conflict", 409);
        return await ReadFeedbackAsync(context, deckId, clients, configuration, cancellationToken);
    }

    private static async Task<IResult> UpdateFeedbackAsync(HttpContext context, string deckId, string feedbackId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var deck) || !TryGuid(feedbackId, out var feedback)) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context); if (auth is null) return Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 4096, cancellationToken); if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !TryString(root, "status", out var status) || status is not ("open" or "resolved") || root.EnumerateObject().Any(p => p.Name != "status")) return Error("invalid-request", 400);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        if (!await IsDeckOwnerAsync(client, url, key, deck, auth.Value, cancellationToken)) return Error("deck-not-found", 404);
        using var response = await PatchAsync(client, url, key, $"deck_feedback?id=eq.{feedback:D}&deck_id=eq.{deck:D}&select=id", new { status }, auth.Value.Token, cancellationToken);
        if (!response.IsSuccessStatusCode) return Error("feedback-not-found", 404);
        using var updated = await ParseJsonAsync(response, cancellationToken);
        if (updated is null || FirstRow(updated.RootElement) is null) return Error("feedback-not-found", 404);
        return await ReadFeedbackAsync(context, deckId, clients, configuration, cancellationToken);
    }

    private static async Task<bool> IsDeckOwnerAsync(HttpClient client, string url, string key, Guid deckId, DeckIdentity auth, CancellationToken cancellationToken)
    {
        using var response = await PostRpcAsync(client, url, key, "read_shared_deck", new { p_deck_id = deckId, p_requester_id = auth.UserId, p_share_token_hash = (string?)null }, cancellationToken, auth.Token);
        if (!response.IsSuccessStatusCode) return false;
        using var json = await ParseJsonAsync(response, cancellationToken);
        var row = json is null ? null : FirstRow(json.RootElement);
        return row is not null && TryDeckRow(row.Value, out var deck) && deck.OwnerId == auth.UserId;
    }

    private readonly record struct DeckIdentity(Guid UserId, string Token);
    private static async Task<DeckIdentity?> DeckIdentityAsync(HttpContext context)
    {
        var principal = await AuthenticateBearerAsync(context);
        var identity = principal is null ? null : SupabaseUserIdentity.TryResolve(principal);
        var authorization = context.Request.Headers.Authorization.ToString();
        return identity is not null && authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) && DeckOwnerHeaderMatches(context, identity.UserId)
            ? new DeckIdentity(identity.UserId, authorization[7..].Trim()) : null;
    }

    private static bool DeckOwnerHeaderMatches(HttpContext context, Guid? authenticatedOwner)
    {
        foreach (var name in new[] { "x-recall-owner", "x-recall-workspace-owner" })
        {
            if (!context.Request.Headers.TryGetValue(name, out var values)) continue;
            if (values.Count != 1 || !TryGuid(values.ToString(), out var expected) || authenticatedOwner != expected) return false;
        }
        return true;
    }

    private static bool TryDeckToken(HttpContext context, out string? token)
    {
        token = null;
        var query = context.Request.Query;
        if (query.Keys.Any(name => name != "token") || query.TryGetValue("token", out var values) && values.Count != 1) return false;
        if (!query.TryGetValue("token", out values)) return true;
        token = values.ToString();
        return ValidShareToken(token);
    }

    private sealed record DeckBody(JsonDocument? Document, string? Error, int Status) : IDisposable
    {
        public void Dispose() => Document?.Dispose();
    }

    private static async Task<DeckBody> ReadDeckJsonAsync(HttpContext context, int maximumBytes, CancellationToken cancellationToken)
    {
        if (context.Request.ContentLength is > 16_384) return new DeckBody(null, "request-too-large", 413);
        if (context.Request.ContentType?.Split(';', 2)[0].Trim().Equals("application/json", StringComparison.OrdinalIgnoreCase) != true) return new DeckBody(null, "invalid-request", 400);
        try
        {
            var bytes = await ReadBoundedBodyAsync(context.Request.Body, maximumBytes, cancellationToken);
            if (bytes is null) return new DeckBody(null, "request-too-large", 413);
            var doc = JsonDocument.Parse(bytes);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) { doc.Dispose(); return new DeckBody(null, "invalid-request", 400); }
            return new DeckBody(doc, null, 200);
        }
        catch (JsonException) { return new DeckBody(null, "invalid-request", 400); }
        catch (IOException) { return new DeckBody(null, "invalid-request", 400); }
    }

    private static bool TryDeckRows(JsonElement value, out DeckData[] rows, bool allowMissingOwner = false)
    {
        rows = [];
        if (value.ValueKind != JsonValueKind.Array) return false;
        var result = new List<DeckData>();
        foreach (var item in value.EnumerateArray()) { if (!TryDeckRow(item, out var row, allowMissingOwner)) return false; result.Add(row); }
        rows = result.ToArray(); return true;
    }

    private sealed record DeckData(Guid Id, Guid OwnerId, string Title, string Description, string Language, string[] Tags,
        string AuthorName, string Visibility, string Status, Guid LatestVersionId, int Version, int CardCount,
        string UpdatedAt, string? License, string? Attribution);

    private static bool TryDeckRow(JsonElement row, out DeckData deck, bool allowMissingOwner = false)
    {
        deck = null!;
        var hasOwner = TryGuid(row, "owner_id", out var owner);
        if (!TryGuid(row, "deck_id", out var id) || (!hasOwner && !allowMissingOwner) ||
            !TryString(row, "title", out var title) || title.Length is < 1 or > 300 ||
            !TryStringAllowEmpty(row, "description", out var description) || description.Length > 4000 ||
            !TryStringAllowEmpty(row, "language", out var language) || language.Length > 40 ||
            !row.TryGetProperty("tags", out var tagValue) || tagValue.ValueKind != JsonValueKind.Array || tagValue.GetArrayLength() > 30 ||
            !TryStringAllowEmpty(row, "author_name", out var author) || author.Length > 120 ||
            !TryString(row, "visibility", out var visibility) || visibility is not ("private" or "unlisted" or "public") ||
            !TryString(row, "status", out var status) || status is not ("active" or "withdrawn" or "hidden") ||
            !TryGuid(row, "latest_version_id", out var latest) ||
            !row.TryGetProperty("version", out var ver) || !ver.TryGetInt32(out var version) || version <= 0 ||
            !row.TryGetProperty("card_count", out var count) || !count.TryGetInt32(out var cardCount) || cardCount < 0 ||
            !TryString(row, "updated_at", out var updated) || !DateTimeOffset.TryParse(updated, out _) ||
            !TryNullableString(row, "license", 120, out var license) || !TryNullableString(row, "attribution", 500, out var attribution)) return false;
        var tags = new List<string>();
        foreach (var item in tagValue.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: <= 80 } text) return false;
            tags.Add(text);
        }
        deck = new DeckData(id, hasOwner ? owner : Guid.Empty, title, description, language, tags.ToArray(), author, visibility, status, latest, version, cardCount, updated, license, attribution);
        return true;
    }

    private static bool TryVersionRows(JsonElement value, out object[] rows)
    {
        rows = [];
        if (value.ValueKind != JsonValueKind.Array) return false;
        var result = new List<object>();
        foreach (var row in value.EnumerateArray())
        {
            if (!TryGuid(row, "id", out var id) || !row.TryGetProperty("version", out var versionNode) || !versionNode.TryGetInt32(out var version) || version <= 0 || !TryString(row, "created_at", out var created) || !DateTimeOffset.TryParse(created, out _)) return false;
            result.Add(new { id = id.ToString("D").ToLowerInvariant(), version, createdAt = created });
        }
        rows = result.ToArray(); return true;
    }

    private static DeckSummary DeckToSummary(DeckData value) => new(value.Id.ToString("D").ToLowerInvariant(), value.Title, value.Description, value.Language, value.Tags, value.AuthorName, value.Visibility, value.Status, value.LatestVersionId.ToString("D").ToLowerInvariant(), value.Version, value.CardCount, value.UpdatedAt, value.License, value.Attribution);

    private static bool TryStringAllowEmpty(JsonElement row, string name, out string value)
    {
        value = string.Empty;
        if (row.ValueKind != JsonValueKind.Object || !row.TryGetProperty(name, out var property) || property.ValueKind != JsonValueKind.String) return false;
        value = property.GetString() ?? string.Empty; return true;
    }

    private static bool ValidateDeckPatch(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Any(p => p.Name is not ("title" or "description" or "language" or "tags" or "authorName" or "status"))) return false;
        if (root.EnumerateObject().Any(p => p.Value.ValueKind == JsonValueKind.Null)) return false;
        if (root.TryGetProperty("title", out var title) && (title.ValueKind != JsonValueKind.String || title.GetString() is not { Length: >= 1 and <= 300 })) return false;
        if (root.TryGetProperty("description", out var description) && (description.ValueKind != JsonValueKind.String || description.GetString() is not { Length: <= 4000 })) return false;
        if (root.TryGetProperty("language", out var language) && (language.ValueKind != JsonValueKind.String || language.GetString() is not { Length: >= 1 and <= 40 })) return false;
        if (root.TryGetProperty("authorName", out var author) && (author.ValueKind != JsonValueKind.String || author.GetString() is not { Length: >= 1 and <= 120 })) return false;
        if (root.TryGetProperty("status", out var status) && (status.ValueKind != JsonValueKind.String || status.GetString() is not ("active" or "withdrawn"))) return false;
        if (root.TryGetProperty("tags", out var tags))
        {
            if (tags.ValueKind != JsonValueKind.Array || tags.GetArrayLength() > 30) return false;
            foreach (var tag in tags.EnumerateArray()) if (tag.ValueKind != JsonValueKind.String || tag.GetString() is not { Length: <= 80 }) return false;
        }
        return root.EnumerateObject().Any();
    }

    private static void AddOptionalString(JsonElement root, IDictionary<string, object?> patch, string name, int maxLength, string? dbName = null)
    {
        if (root.TryGetProperty(name, out var value)) patch[dbName ?? Snake(name)] = value.GetString();
        static string Snake(string text) => string.Concat(text.Select((c, i) => char.IsUpper(c) ? "_" + char.ToLowerInvariant(c) : c.ToString()));
    }

    private static async Task<HttpResponseMessage> PatchAsync(HttpClient client, string url, string key, string path, object body, string bearer, CancellationToken ct) => await SendJsonAsync(client, url, key, HttpMethod.Patch, path, body, bearer, ct, "return=representation");
    private static async Task<HttpResponseMessage> UpsertAsync(HttpClient client, string url, string key, string path, object body, string bearer, CancellationToken ct) => await SendJsonAsync(client, url, key, HttpMethod.Post, path, body, bearer, ct, "resolution=merge-duplicates,return=minimal");
    private static async Task<HttpResponseMessage> InsertIgnoreDuplicatesAsync(HttpClient client, string url, string key, string path, object body, string bearer, CancellationToken ct) => await SendJsonAsync(client, url, key, HttpMethod.Post, path, body, bearer, ct, "resolution=ignore-duplicates,return=minimal");
    private static async Task<HttpResponseMessage> DeleteAsync(HttpClient client, string url, string key, string path, string bearer, CancellationToken ct)
    {
        using var request = BuildRequest(HttpMethod.Delete, url, key, path, bearer);
        request.Headers.TryAddWithoutValidation("Prefer", "return=minimal");
        return await SendAsync(client, request, ct);
    }
    private static async Task<HttpResponseMessage> SendJsonAsync(HttpClient client, string url, string key, HttpMethod method, string path, object body, string bearer, CancellationToken ct, string prefer)
    {
        using var request = BuildRequest(method, url, key, path, bearer);
        request.Headers.TryAddWithoutValidation("Prefer", prefer);
        request.Content = JsonContent.Create(body);
        return await SendAsync(client, request, ct);
    }
}
