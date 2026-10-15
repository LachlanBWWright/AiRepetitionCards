using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Recall.Infrastructure.SupabaseAuth;

namespace Recall.Api.Features.Publishing;

public static partial class PublishingEndpoints
{
    private static void MapModerationEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/decks/{deckId}/reports", ReportDeckAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapPost("/api/v1/decks/{deckId}/block", BlockPublisherAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapDelete("/api/v1/decks/{deckId}/block", UnblockPublisherAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapGet("/api/v1/moderation/reports", ListModerationReportsAsync).AllowAnonymous().WithDeckRateLimit();
        endpoints.MapPatch("/api/v1/moderation/decks/{deckId}", UpdateModeratedDeckAsync).AllowAnonymous().WithDeckRateLimit(write: true);
        endpoints.MapPatch("/api/v1/moderation/reports/{reportId}", UpdateModerationReportAsync).AllowAnonymous().WithDeckRateLimit(write: true);
    }

    private static async Task<IResult> ReadSubscriptionUpdatesAsync(HttpContext context, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return Error("unauthenticated", 401);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, key, "list_deck_subscription_updates", new { p_user_id = auth.Value.UserId }, cancellationToken, auth.Value.Token);
        return await ReadUpdatesResponseAsync(response, cancellationToken);
    }

    private static async Task<IResult> ReadSubscriptionUpdateAsync(HttpContext context, string areaId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(areaId, out var area)) return Error("invalid-request", 400);
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 4096, cancellationToken);
        if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (!TryGuid(root, "versionId", out var version) || root.EnumerateObject().Any(property => property.Name != "versionId")) return Error("invalid-request", 400);
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, key, "acknowledge_deck_subscription_update", new { p_user_id = auth.Value.UserId, p_area_id = area, p_version_id = version }, cancellationToken, auth.Value.Token);
        return await ReadUpdatesResponseAsync(response, cancellationToken);
    }

    private static async Task<IResult> ReadUpdatesResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode) return Error("subscription-update-unavailable", 503);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || json.RootElement.ValueKind != JsonValueKind.Array) return Error("publication-response-invalid", 502);
        var updates = new List<object>();
        foreach (var row in json.RootElement.EnumerateArray().Take(500))
        {
            if (!TryGuid(row, "deck_id", out var deck) || !TryGuid(row, "area_id", out var area) ||
                !TryGuid(row, "known_version_id", out var known) || !TryGuid(row, "latest_version_id", out var latest) ||
                !row.TryGetProperty("latest_version", out var versionElement) || !versionElement.TryGetInt32(out var version) || version <= 0 ||
                !TryString(row, "title", out var title) || title.Length is < 1 or > 300 || !TryString(row, "release_notes", out var notes) || notes.Length > 4000 ||
                !TryString(row, "created_at", out var created) || !DateTimeOffset.TryParse(created, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _) ||
                !row.TryGetProperty("seen", out var seen) || seen.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Error("publication-response-invalid", 502);
            updates.Add(new { deckId = deck.ToString("D").ToLowerInvariant(), areaId = area.ToString("D").ToLowerInvariant(), knownVersionId = known.ToString("D").ToLowerInvariant(), latestVersionId = latest.ToString("D").ToLowerInvariant(), latestVersion = version, title, releaseNotes = notes, createdAt = created, seen = seen.GetBoolean() });
        }
        return Results.Json(new { schemaVersion = 1, updates });
    }

    private static async Task<IResult> ReportDeckAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var deck)) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 8192, cancellationToken);
        if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (!TryGuid(root, "id", out var reportId) || !TryGuid(root, "versionId", out var version) ||
            !TryString(root, "reason", out var reason) || reason is not ("spam" or "harmful" or "copyright" or "broken") ||
            !TryString(root, "message", out var message) || message.Length is < 1 or > 2000 ||
            root.EnumerateObject().Any(property => property.Name is not ("id" or "versionId" or "reason" or "message" or "token"))) return Error("invalid-request", 400);
        string? token = null;
        if (root.TryGetProperty("token", out var tokenElement))
        {
            if (tokenElement.ValueKind != JsonValueKind.String || !ValidShareToken(tokenElement.GetString() ?? "")) return Error("invalid-request", 400);
            token = tokenElement.GetString();
        }
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, key, "create_deck_report", new { p_id = reportId, p_user_id = auth.Value.UserId, p_deck_id = deck, p_version_id = version, p_reason = reason, p_message = message, p_share_token_hash = token is null ? null : Hash(token) }, cancellationToken, auth.Value.Token);
        if (!response.IsSuccessStatusCode) return Error("report-invalid", 409);
        using var json = await ParseJsonAsync(response, cancellationToken);
        var row = json is null ? null : FirstRow(json.RootElement);
        if (row is null || !TryGuid(row.Value, "id", out var savedId) || savedId != reportId || !TryString(row.Value, "status", out var status) || status is not ("open" or "resolved")) return Error("publication-response-invalid", 502);
        return Results.Json(new { schemaVersion = 1, reportId = savedId.ToString("D").ToLowerInvariant(), status });
    }

    private static Task<IResult> BlockPublisherAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken) => SetPublisherBlockAsync(context, deckId, true, clients, configuration, cancellationToken);
    private static Task<IResult> UnblockPublisherAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken) => SetPublisherBlockAsync(context, deckId, false, clients, configuration, cancellationToken);

    private static async Task<IResult> SetPublisherBlockAsync(HttpContext context, string deckId, bool blocked, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var deck)) return Error("deck-not-found", 404);
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return Error("unauthenticated", 401);
        var hasBody = context.Request.ContentLength is > 0 || context.Request.ContentType is not null && context.Request.ContentLength != 0;
        using var body = hasBody ? await ReadDeckJsonAsync(context, 4096, cancellationToken) : new DeckBody(null, null, 200);
        if (body.Error is not null) return Error(body.Error, body.Status);
        string? token = null;
        if (body.Document is not null)
        {
            var root = body.Document.RootElement;
            if (root.EnumerateObject().Any(property => property.Name != "token")) return Error("invalid-request", 400);
            if (root.TryGetProperty("token", out var tokenElement))
            {
                if (tokenElement.ValueKind != JsonValueKind.String || !ValidShareToken(tokenElement.GetString() ?? "")) return Error("invalid-request", 400);
                token = tokenElement.GetString();
            }
        }
        if (!TryConfiguration(configuration, out var url, out var key)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, key, "set_blocked_deck_publisher", new { p_user_id = auth.Value.UserId, p_deck_id = deck, p_blocked = blocked, p_share_token_hash = token is null ? null : Hash(token) }, cancellationToken, auth.Value.Token);
        if (!response.IsSuccessStatusCode) return Error("deck-not-found", 404);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || json.RootElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return Error("publication-response-invalid", 502);
        return Results.Json(new { schemaVersion = 1, blocked = json.RootElement.GetBoolean() });
    }

    private static async Task<IResult> ListModerationReportsAsync(HttpContext context, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        var moderator = await ModeratorIdentityAsync(context, configuration);
        if (moderator.Identity is null) return moderator.Authenticated ? Error("forbidden", 403) : Error("unauthenticated", 401);
        if (!TryServiceConfiguration(configuration, out var url, out var serviceKey)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, serviceKey, "moderator_list_deck_reports", new { p_actor_id = moderator.Identity.Value.UserId }, cancellationToken, serviceKey);
        if (!response.IsSuccessStatusCode) return Error("publication-unavailable", 503);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || json.RootElement.ValueKind != JsonValueKind.Array) return Error("publication-response-invalid", 502);
        var reports = new List<object>();
        foreach (var row in json.RootElement.EnumerateArray().Take(1000))
        {
            if (!TryGuid(row, "id", out var id) || !TryGuid(row, "deck_id", out var deck) || !TryGuid(row, "version_id", out var version) ||
                !TryString(row, "title", out var title) || title.Length is < 1 or > 300 || !TryString(row, "reason", out var reason) || reason.Length is < 1 or > 32 || !TryString(row, "message", out var message) || message.Length is < 1 or > 2000 ||
                !TryString(row, "status", out var status) || status is not ("open" or "resolved") || !TryString(row, "created_at", out var created)) return Error("publication-response-invalid", 502);
            reports.Add(new { id = id.ToString("D").ToLowerInvariant(), deckId = deck.ToString("D").ToLowerInvariant(), versionId = version.ToString("D").ToLowerInvariant(), title, reason, message, status, createdAt = created });
        }
        return Results.Json(new { schemaVersion = 1, reports });
    }

    private static async Task<IResult> UpdateModeratedDeckAsync(HttpContext context, string deckId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(deckId, out var deck)) return Error("invalid-request", 400);
        var moderator = await ModeratorIdentityAsync(context, configuration);
        if (moderator.Identity is null) return moderator.Authenticated ? Error("forbidden", 403) : Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 4096, cancellationToken);
        if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (!TryString(root, "status", out var status) || status is not ("visible" or "hidden") || !TryString(root, "reason", out var reason) || reason.Length is < 1 or > 2000 || root.EnumerateObject().Any(property => property.Name is not ("status" or "reason"))) return Error("invalid-request", 400);
        return await WriteModerationActionAsync(clients, configuration, moderator.Identity.Value.UserId, "moderator_set_deck_status", new { p_actor_id = moderator.Identity.Value.UserId, p_deck_id = deck, p_status = status, p_reason = reason }, cancellationToken);
    }

    private static async Task<IResult> UpdateModerationReportAsync(HttpContext context, string reportId, IHttpClientFactory clients, IConfiguration configuration, CancellationToken cancellationToken)
    {
        if (!TryGuid(reportId, out var report)) return Error("invalid-request", 400);
        var moderator = await ModeratorIdentityAsync(context, configuration);
        if (moderator.Identity is null) return moderator.Authenticated ? Error("forbidden", 403) : Error("unauthenticated", 401);
        using var body = await ReadDeckJsonAsync(context, 4096, cancellationToken);
        if (body.Error is not null) return Error(body.Error, body.Status);
        var root = body.Document!.RootElement;
        if (!TryString(root, "status", out var status) || status is not ("open" or "resolved") || root.EnumerateObject().Any(property => property.Name != "status")) return Error("invalid-request", 400);
        return await WriteModerationActionAsync(clients, configuration, moderator.Identity.Value.UserId, "moderator_set_deck_report_status", new { p_actor_id = moderator.Identity.Value.UserId, p_report_id = report, p_status = status }, cancellationToken);
    }

    private static async Task<IResult> WriteModerationActionAsync(IHttpClientFactory clients, IConfiguration configuration, Guid actor, string function, object payload, CancellationToken cancellationToken)
    {
        if (!TryServiceConfiguration(configuration, out var url, out var serviceKey)) return Error("publication-unavailable", 503);
        using var client = clients.CreateClient();
        using var response = await PostRpcAsync(client, url, serviceKey, function, payload, cancellationToken, serviceKey);
        if (!response.IsSuccessStatusCode) return Error("moderation-update-failed", 409);
        using var json = await ParseJsonAsync(response, cancellationToken);
        if (json is null || json.RootElement.ValueKind is not (JsonValueKind.True or JsonValueKind.False) || !json.RootElement.GetBoolean()) return Error("deck-not-found", 404);
        return Results.Json(new { schemaVersion = 1, ok = true });
    }

    private static async Task<(DeckIdentity? Identity, bool Authenticated)> ModeratorIdentityAsync(HttpContext context, IConfiguration configuration)
    {
        var auth = await DeckIdentityAsync(context);
        if (auth is null) return (null, false);
        if (!TryModeratorIds(configuration, out var moderators) || !moderators.Contains(auth.Value.UserId)) return (null, true);
        return (auth, true);
    }

    private static bool TryModeratorIds(IConfiguration configuration, out HashSet<Guid> ids)
    {
        ids = [];
        var value = configuration["RECALL_MODERATOR_USER_IDS"];
        if (string.IsNullOrWhiteSpace(value)) return false;
        foreach (var entry in value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!Guid.TryParse(entry, out var id)) return false;
            ids.Add(id);
        }
        return ids.Count > 0;
    }

    private static bool TryServiceConfiguration(IConfiguration configuration, out string url, out string serviceKey)
    {
        serviceKey = configuration["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
        var validUrl = TryConfiguration(configuration, out url, out _);
        return validUrl && !string.IsNullOrWhiteSpace(serviceKey);
    }
}
