using System.Collections.Immutable;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed record TutorPrivacyFailure(string Code);

public abstract record Result<TValue, TError>
{
    private Result() { }
    public sealed record Success(TValue Value) : Result<TValue, TError>;
    public sealed record Failure(TError Error) : Result<TValue, TError>;
}

/// <summary>Service-role-only tutor transcript deletion and bounded retention operations.</summary>
public sealed class TutorPrivacyOperations(HttpClient httpClient, IConfiguration configuration)
{
    private const int MaximumBatchSize = 1_000;

    public bool IsAdminConfigured => TryAdmin(out _, out _);

    public async Task<Result<int, TutorPrivacyFailure>> DeleteOwnedHistoryAsync(
        Guid ownerId,
        CancellationToken cancellationToken = default)
    {
        if (ownerId == Guid.Empty || !TryAdmin(out var baseUri, out var key))
            return Fail();
        using var request = CreateRequest(HttpMethod.Delete,
            new Uri(baseUri, $"rest/v1/tutor_sessions?user_id=eq.{ownerId:D}&select=id"), key);
        request.Headers.TryAddWithoutValidation("Prefer", "count=exact,return=minimal");
        return await DeleteCountAsync(request, cancellationToken);
    }

    public async Task<Result<int, TutorPrivacyFailure>> PurgeExpiredAsync(
        DateTimeOffset cutoff,
        int batchSize,
        CancellationToken cancellationToken = default)
    {
        if (batchSize is < 1 or > MaximumBatchSize || !TryAdmin(out var baseUri, out var key))
            return Fail();
        var cutoffText = Uri.EscapeDataString(cutoff.UtcDateTime.ToString("O", CultureInfo.InvariantCulture));
        using var select = CreateRequest(HttpMethod.Get, new Uri(baseUri,
            $"rest/v1/tutor_sessions?select=id,user_id&updated_at=lt.{cutoffText}&order=updated_at.asc,id.asc&limit={batchSize}"), key);
        var selected = await SendRowsAsync(select, cancellationToken);
        if (selected is Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure selectionFailure)
            return Fail(selectionFailure.Error.Code);
        var sessions = ((Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Success)selected).Value;
        if (sessions.Length > batchSize)
            return Fail();

        var deleted = 0;
        foreach (var group in sessions.GroupBy(session => session.UserId))
        {
            var ids = string.Join(',', group.Select(session => session.Id.ToString("D")));
            var owner = group.Key.ToString("D");
            using var request = CreateRequest(HttpMethod.Delete, new Uri(baseUri,
                $"rest/v1/tutor_sessions?user_id=eq.{owner}&id=in.({ids})&updated_at=lt.{cutoffText}&select=id"), key);
            request.Headers.TryAddWithoutValidation("Prefer", "count=exact,return=minimal");
            var result = await DeleteCountAsync(request, cancellationToken);
            if (result is Result<int, TutorPrivacyFailure>.Failure deletionFailure)
                return Fail(deletionFailure.Error.Code);
            deleted += ((Result<int, TutorPrivacyFailure>.Success)result).Value;
        }

        return new Result<int, TutorPrivacyFailure>.Success(deleted);
    }

    private bool TryAdmin(out Uri baseUri, out string key)
    {
        var url = configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"];
        key = configuration["SUPABASE_SERVICE_ROLE_KEY"]?.Trim() ?? string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var projectUri) ||
            (projectUri.Scheme != Uri.UriSchemeHttps && projectUri.Host != "localhost") ||
            key.Length == 0)
        {
            baseUri = new Uri("https://invalid.invalid/");
            return false;
        }
        baseUri = new Uri(projectUri, "/rest/v1/");
        return true;
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, Uri uri, string key)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.TryAddWithoutValidation("apikey", key);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    private async Task<Result<int, TutorPrivacyFailure>> DeleteCountAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return Fail("upstream-failure");
            if (!response.Headers.TryGetValues("Content-Range", out var rangeValues))
                return Fail("invalid-response");
            var range = rangeValues.SingleOrDefault();
            var separator = range?.LastIndexOf('/') ?? -1;
            if (separator < 0 || !int.TryParse(range![(separator + 1)..], out var count) || count < 0)
                return Fail("invalid-response");
            return new Result<int, TutorPrivacyFailure>.Success(count);
        }
        catch (HttpRequestException)
        {
            return Fail("upstream-failure");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Fail("upstream-failure");
        }
        catch (JsonException)
        {
            return Fail("invalid-response");
        }
        catch (IOException)
        {
            return Fail("upstream-failure");
        }
    }

    private async Task<Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>> SendRowsAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("upstream-failure"));
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
                return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("invalid-response"));
            var rows = ImmutableArray.CreateBuilder<ExpiredSession>();
            foreach (var row in document.RootElement.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.Object ||
                    !row.TryGetProperty("id", out var idElement) || idElement.ValueKind != JsonValueKind.String ||
                    !TryUuid(idElement.GetString(), out var id) || id == Guid.Empty ||
                    !row.TryGetProperty("user_id", out var ownerElement) || ownerElement.ValueKind != JsonValueKind.String ||
                    !TryUuid(ownerElement.GetString(), out var owner) || owner == Guid.Empty)
                    return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("invalid-response"));
                rows.Add(new ExpiredSession(id, owner));
            }
            return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Success(rows.ToImmutable());
        }
        catch (HttpRequestException)
        {
            return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("upstream-failure"));
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("upstream-failure"));
        }
        catch (JsonException)
        {
            return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("invalid-response"));
        }
        catch (IOException)
        {
            return new Result<ImmutableArray<ExpiredSession>, TutorPrivacyFailure>.Failure(new("upstream-failure"));
        }
    }

    private static bool TryUuid(string? value, out Guid result)
    {
        result = Guid.Empty;
        if (value is null || value.Length != 36 || !Guid.TryParseExact(value, "D", out var parsed)) return false;
        var variant = char.ToLowerInvariant(value[19]);
        if (value[14] is < '1' or > '8' || variant is not ('8' or '9' or 'a' or 'b')) return false;
        result = parsed;
        return true;
    }

    private static Result<int, TutorPrivacyFailure> Fail(string code = "unavailable") =>
        new Result<int, TutorPrivacyFailure>.Failure(new TutorPrivacyFailure(code));

    private sealed record ExpiredSession(Guid Id, Guid UserId);
}
