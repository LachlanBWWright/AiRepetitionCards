using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

internal sealed class TutorSharedAiBudget(IHttpClientFactory clients, IConfiguration configuration)
{
    private const string ReserveScript = "local existing=redis.call('HGET',KEYS[2],'units'); if existing then if redis.call('HGET',KEYS[2],'fingerprint')~=ARGV[4] then return -2 end; return tonumber(existing) end; local spent=tonumber(redis.call('HGET',KEYS[1],'units') or '0'); local calls=tonumber(redis.call('HGET',KEYS[1],'calls') or '0'); local hold=tonumber(ARGV[1]); if (tonumber(ARGV[2])>0 and spent+hold>tonumber(ARGV[2])) or calls>=tonumber(ARGV[3]) then return -1 end; redis.call('HINCRBY',KEYS[1],'units',hold); redis.call('HINCRBY',KEYS[1],'calls',1); redis.call('HSET',KEYS[2],'units',hold,'fingerprint',ARGV[4]); redis.call('EXPIRE',KEYS[1],259200); redis.call('EXPIRE',KEYS[2],259200); return hold";
    private const string SettleScript = "local hold=redis.call('HGET',KEYS[2],'units'); if not hold or tonumber(hold)~=tonumber(ARGV[1]) then return -2 end; local settled=redis.call('HGET',KEYS[2],'settled'); if settled then if tonumber(settled)~=tonumber(ARGV[2]) then return -2 end; return 1 end; if redis.call('EXISTS',KEYS[1])~=1 then return -2 end; redis.call('HINCRBY',KEYS[1],'units',tonumber(ARGV[2])-tonumber(hold)); redis.call('HSET',KEYS[2],'settled',ARGV[2]); return 1";

    public async Task<BudgetReservationResult> ReserveAsync(string userId, Guid callId, TutorProviderRequest request, CancellationToken token)
    {
        var budgetRaw = configuration["AI_DAILY_TOKEN_BUDGET"]?.Trim();
        var limitRaw = configuration["AI_DAILY_REQUEST_LIMIT"]?.Trim();
        if (string.IsNullOrEmpty(budgetRaw) && string.IsNullOrEmpty(limitRaw)) return new BudgetReservationResult.Disabled();
        var budget = string.IsNullOrEmpty(budgetRaw) ? 0 : ParsePositive(budgetRaw);
        var requestLimit = string.IsNullOrEmpty(limitRaw) ? 30 : ParsePositive(limitRaw);
        var urlRaw = configuration["AI_BUDGET_STORE_REST_URL"];
        var tokenValue = configuration["AI_BUDGET_STORE_REST_TOKEN"]?.Trim();
        var prefix = configuration["AI_BUDGET_STORE_PREFIX"]?.Trim();
        if (string.IsNullOrEmpty(prefix)) prefix = "recall:ai-budget";
        if (budget < 0 || requestLimit is < 1 or > 30 || string.IsNullOrEmpty(tokenValue) || prefix.Length > 64 ||
            !prefix.All(c => char.IsAsciiLetterOrDigit(c) || c is ':' or '_' or '-') ||
            !Uri.TryCreate(urlRaw, UriKind.Absolute, out var url) || url.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(url.UserInfo) || !string.IsNullOrEmpty(url.Query) || !string.IsNullOrEmpty(url.Fragment) ||
            !TryUuid(userId, out var ownerId)) return new BudgetReservationResult.Unavailable();
        var day = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var counterKey = $"{prefix}:{{{ownerId:D}:{day}}}:total";
        var reservationKey = $"{prefix}:{{{ownerId:D}:{day}}}:call:{callId:D}";
        var requestBytes = RequestBytes(request);
        var hold = requestBytes + request.MaximumOutputTokens;
        if (hold <= 0) return new BudgetReservationResult.Unavailable();
        var fingerprint = JsonSerializer.Serialize(new object[] { request.Operation, request.Model, requestBytes, request.MaximumOutputTokens });
        var result = await EvalAsync(url, tokenValue, ReserveScript, counterKey, reservationKey,
            [hold.ToString(CultureInfo.InvariantCulture), budget.ToString(CultureInfo.InvariantCulture), requestLimit.ToString(CultureInfo.InvariantCulture), fingerprint], token);
        if (result is null) return new BudgetReservationResult.Unavailable();
        if (result == -1) return new BudgetReservationResult.Exceeded();
        return result == hold ? new BudgetReservationResult.Reserved(url, tokenValue, counterKey, reservationKey, hold) : new BudgetReservationResult.Unavailable();
    }

    public async Task<bool> SettleAsync(BudgetReservationResult.Reserved reservation, int inputTokens, int outputTokens, CancellationToken token)
    {
        if (inputTokens < 0 || outputTokens < 0) return false;
        var actual = (long)inputTokens + outputTokens;
        var result = await EvalAsync(reservation.Url, reservation.Token, SettleScript,
            reservation.CounterKey, reservation.ReservationKey,
            [reservation.Hold.ToString(CultureInfo.InvariantCulture), actual.ToString(CultureInfo.InvariantCulture)], token);
        return result == 1;
    }

    private async Task<long?> EvalAsync(Uri url, string tokenValue, string script, string counterKey, string reservationKey,
        IReadOnlyList<string> arguments, CancellationToken token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", tokenValue);
        request.Content = JsonContent.Create(new object[] { "EVAL", script, 2, counterKey, reservationKey }.Concat(arguments).ToArray());
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            using var response = await clients.CreateClient().SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token);
            return document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("result", out var result) && result.TryGetInt64(out var number) ? number : null;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) when (!token.IsCancellationRequested) { return null; }
        catch (JsonException) { return null; }
        catch (IOException) { return null; }
    }

    private static int RequestBytes(TutorProviderRequest request) => JsonSerializer.SerializeToUtf8Bytes(new
    {
        model = request.Model,
        store = false,
        max_output_tokens = request.MaximumOutputTokens,
        instructions = TutorProviderPrompt.Compose(request.Instructions),
        input = request.Input,
        text = new
        {
            format = new
            {
                type = "json_schema",
                name = request.Operation.Replace("-", "_", StringComparison.Ordinal),
                strict = true,
                schema = request.OutputSchema
            }
        }
    }, new JsonSerializerOptions(JsonSerializerDefaults.Web)).Length;

    private static bool TryUuid(string? value, out Guid result)
    {
        result = Guid.Empty;
        if (value is null || value.Length != 36 || !Guid.TryParseExact(value, "D", out var parsed)) return false;
        var variant = char.ToLowerInvariant(value[19]);
        if (value[14] is < '1' or > '8' || variant is not ('8' or '9' or 'a' or 'b')) return false;
        result = parsed;
        return true;
    }

    private static int ParsePositive(string value) => value.Length is > 0 and <= 10 && value[0] is >= '1' and <= '9' &&
        value.All(char.IsAsciiDigit) && int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) &&
        parsed <= 1_000_000_000 ? parsed : -1;
}

internal abstract record BudgetReservationResult
{
    internal sealed record Disabled : BudgetReservationResult;
    internal sealed record Exceeded : BudgetReservationResult;
    internal sealed record Unavailable : BudgetReservationResult;
    internal sealed record Reserved(Uri Url, string Token, string CounterKey, string ReservationKey, int Hold) : BudgetReservationResult;
}
