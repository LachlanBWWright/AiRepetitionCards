using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed class ManagedAiStore(IHttpClientFactory clients, IConfiguration configuration)
{
    public bool Enabled => configuration["MANAGED_AI_ENABLED"] == "true";

    public async Task<JsonElement?> RpcAsync(string name, object body, CancellationToken token)
    {
        var origin = configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"];
        var key = configuration["SUPABASE_SERVICE_ROLE_KEY"];
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var url) ||
            (url.Scheme != "https" && !url.IsLoopback) || string.IsNullOrWhiteSpace(key)) return null;
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(url, $"/rest/v1/rpc/{name}"));
        request.Headers.TryAddWithoutValidation("apikey", key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Content = JsonContent.Create(body);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode) return null;
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            return document.RootElement.Clone();
        }
        catch (HttpRequestException) { return null; }
        catch (OperationCanceledException) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    public static TutorProviderFailureKind Denial(JsonElement? value)
    {
        var reason = value is { ValueKind: JsonValueKind.Object } json && json.TryGetProperty("reason", out var text) && text.ValueKind == JsonValueKind.String ? text.GetString() : null;
        return reason switch
        {
            "managed-disabled" or "managed-not-entitled" => TutorProviderFailureKind.ManagedNotEntitled,
            "managed-budget-exceeded" => TutorProviderFailureKind.SharedBudgetExceeded,
            "managed-concurrency-limit" => TutorProviderFailureKind.RateLimited,
            "request-too-large" => TutorProviderFailureKind.ContextTooLarge,
            "route-unavailable" or "route-changed" => TutorProviderFailureKind.NotConfigured,
            _ => TutorProviderFailureKind.SharedBudgetUnavailable
        };
    }
    public static bool Allowed(JsonElement? value) => value is { ValueKind: JsonValueKind.Object } json &&
        json.TryGetProperty("allowed", out var allowed) && allowed.ValueKind == JsonValueKind.True;
}
