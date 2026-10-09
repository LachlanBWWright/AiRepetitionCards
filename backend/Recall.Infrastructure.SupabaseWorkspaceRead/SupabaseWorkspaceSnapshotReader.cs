using System.Collections.Immutable;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Infrastructure.SupabaseWorkspaceRead;

/// <summary>Credentials from an already authenticated API request.</summary>
public sealed record SupabaseReadContext(
    Uri ProjectUrl,
    string PublishableKey,
    string AccessToken,
    Guid UserId);

/// <summary>Owner-scoped rows needed to build a workspace snapshot.</summary>
public sealed record WorkspaceSnapshotRows(
    ImmutableArray<WorkspaceAreaRow> Areas,
    ImmutableArray<DeletedWorkspaceAreaRow> DeletedAreas,
    ImmutableArray<WorkspaceAreaVersionRow> Versions);

public sealed record WorkspaceAreaRow(string Id, string Color);
public sealed record DeletedWorkspaceAreaRow(string Id);
public sealed record WorkspaceAreaVersionRow(
    string KnowledgeAreaId,
    int Version,
    JsonElement Content,
    string ContentHash);

public enum WorkspaceReadFailureKind
{
    InvalidConfiguration,
    Unauthorized,
    Forbidden,
    UpstreamFailure,
    InvalidResponse
}

public sealed record WorkspaceReadFailure(WorkspaceReadFailureKind Kind);

public interface IWorkspaceSnapshotReader
{
    Task<Result<WorkspaceSnapshotRows, WorkspaceReadFailure>> ReadAsync(
        SupabaseReadContext context,
        CancellationToken cancellationToken = default);
}

public sealed class SupabaseWorkspaceSnapshotReader(HttpClient httpClient) : IWorkspaceSnapshotReader
{
    private const int MaximumAreasPerRequest = 1000;
    private const int MaximumIdsPerQuery = 100;
    private const int PageSize = 1000;

    /// <summary>
    /// Reads workspace rows with the caller's JWT, allowing Supabase row-level security
    /// to enforce the same owner boundary used by the existing Next.js route.
    /// </summary>
    public async Task<Result<WorkspaceSnapshotRows, WorkspaceReadFailure>> ReadAsync(
        SupabaseReadContext context,
        CancellationToken cancellationToken = default)
    {
        if (!context.ProjectUrl.IsAbsoluteUri ||
            (context.ProjectUrl.Scheme != Uri.UriSchemeHttps && context.ProjectUrl.Host != "localhost") ||
            string.IsNullOrWhiteSpace(context.PublishableKey) ||
            string.IsNullOrWhiteSpace(context.AccessToken) ||
            context.UserId == Guid.Empty)
        {
            return Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Fail(
                new WorkspaceReadFailure(WorkspaceReadFailureKind.InvalidConfiguration));
        }

        var areasResult = await GetRowsAsync(
            context,
            "knowledge_areas?select=id,color&deleted_at=is.null&order=updated_at.desc&limit=" + MaximumAreasPerRequest,
            ParseAreas,
            cancellationToken);
        if (areasResult is Result<ImmutableArray<WorkspaceAreaRow>, WorkspaceReadFailure>.Failure areasFailure)
        {
            return Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Fail(areasFailure.Error);
        }
        var areas = ((Result<ImmutableArray<WorkspaceAreaRow>, WorkspaceReadFailure>.Success)areasResult).Value;

        var deletedAreasResult = await GetRowsAsync(
            context,
            "knowledge_areas?select=id&deleted_at=not.is.null",
            ParseDeletedAreas,
            cancellationToken);
        if (deletedAreasResult is Result<ImmutableArray<DeletedWorkspaceAreaRow>, WorkspaceReadFailure>.Failure deletedFailure)
        {
            return Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Fail(deletedFailure.Error);
        }
        var deletedAreas = ((Result<ImmutableArray<DeletedWorkspaceAreaRow>, WorkspaceReadFailure>.Success)deletedAreasResult).Value;

        var versions = ImmutableArray.CreateBuilder<WorkspaceAreaVersionRow>();
        foreach (var idChunk in areas.Select(area => area.Id).Chunk(MaximumIdsPerQuery))
        {
            var ids = string.Join(',', idChunk.Select(id => "\"" + id + "\""));
            var query = "knowledge_area_versions?select=knowledge_area_id,version,content,content_hash&knowledge_area_id=in.(" +
                        Uri.EscapeDataString(ids) + ")&order=version.desc";
            var chunkResult = await GetRowsAsync(context, query, ParseVersions, cancellationToken);
            if (chunkResult is Result<ImmutableArray<WorkspaceAreaVersionRow>, WorkspaceReadFailure>.Failure chunkFailure)
            {
                return Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Fail(chunkFailure.Error);
            }

            versions.AddRange(((Result<ImmutableArray<WorkspaceAreaVersionRow>, WorkspaceReadFailure>.Success)chunkResult).Value);
        }

        return Result<WorkspaceSnapshotRows, WorkspaceReadFailure>.Succeed(new WorkspaceSnapshotRows(
            areas,
            deletedAreas,
            versions.ToImmutable()));
    }

    private async Task<Result<ImmutableArray<T>, WorkspaceReadFailure>> GetRowsAsync<T>(
        SupabaseReadContext context,
        string relativeQuery,
        Func<JsonElement, ImmutableArray<T>?> parse,
        CancellationToken cancellationToken)
    {
        var accumulated = ImmutableArray.CreateBuilder<T>();
        var offset = 0;
        while (true)
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                new Uri(new Uri(context.ProjectUrl, "/rest/v1/"), relativeQuery));
            request.Headers.TryAddWithoutValidation("apikey", context.PublishableKey);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", context.AccessToken);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            request.Headers.TryAddWithoutValidation("Range-Unit", "items");
            request.Headers.TryAddWithoutValidation("Range", $"{offset}-{offset + PageSize - 1}");

            HttpResponseMessage response;
            try
            {
                response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            }
            catch (HttpRequestException)
            {
                return Failure<T>(WorkspaceReadFailureKind.UpstreamFailure);
            }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return Failure<T>(WorkspaceReadFailureKind.UpstreamFailure);
            }

            using (response)
            {
                if (!response.IsSuccessStatusCode)
                {
                    var kind = response.StatusCode switch
                    {
                        HttpStatusCode.Unauthorized => WorkspaceReadFailureKind.Unauthorized,
                        HttpStatusCode.Forbidden => WorkspaceReadFailureKind.Forbidden,
                        _ => WorkspaceReadFailureKind.UpstreamFailure
                    };
                    return Failure<T>(kind);
                }

                try
                {
                    await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
                    var rows = parse(document.RootElement);
                    if (rows is null)
                    {
                        return Failure<T>(WorkspaceReadFailureKind.InvalidResponse);
                    }

                    accumulated.AddRange(rows.Value);
                    if (rows.Value.Length < PageSize)
                    {
                        return Result<ImmutableArray<T>, WorkspaceReadFailure>.Succeed(accumulated.ToImmutable());
                    }

                    offset += rows.Value.Length;
                }
                catch (JsonException)
                {
                    return Failure<T>(WorkspaceReadFailureKind.InvalidResponse);
                }
                catch (IOException)
                {
                    return Failure<T>(WorkspaceReadFailureKind.UpstreamFailure);
                }
            }
        }
    }

    private static ImmutableArray<WorkspaceAreaRow>? ParseAreas(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array || root.GetArrayLength() > MaximumAreasPerRequest)
        {
            return null;
        }

        var rows = ImmutableArray.CreateBuilder<WorkspaceAreaRow>();
        foreach (var row in root.EnumerateArray())
        {
            if (!TryString(row, "id", out var id) || !Guid.TryParse(id, out _) ||
                !TryString(row, "color", out var color))
            {
                return null;
            }

            rows.Add(new WorkspaceAreaRow(id, color));
        }

        return rows.ToImmutable();
    }

    private static ImmutableArray<DeletedWorkspaceAreaRow>? ParseDeletedAreas(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var rows = ImmutableArray.CreateBuilder<DeletedWorkspaceAreaRow>();
        foreach (var row in root.EnumerateArray())
        {
            if (!TryString(row, "id", out var id) || !Guid.TryParse(id, out _))
            {
                return null;
            }

            rows.Add(new DeletedWorkspaceAreaRow(id));
        }

        return rows.ToImmutable();
    }

    private static ImmutableArray<WorkspaceAreaVersionRow>? ParseVersions(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var rows = ImmutableArray.CreateBuilder<WorkspaceAreaVersionRow>();
        foreach (var row in root.EnumerateArray())
        {
            if (!TryString(row, "knowledge_area_id", out var areaId) || !Guid.TryParse(areaId, out _) ||
                !row.TryGetProperty("version", out var versionElement) ||
                !versionElement.TryGetInt32(out var version) || version <= 0 ||
                !row.TryGetProperty("content", out var content) ||
                !TryString(row, "content_hash", out var contentHash) ||
                contentHash.Length != 64 || !contentHash.All(Uri.IsHexDigit))
            {
                return null;
            }

            rows.Add(new WorkspaceAreaVersionRow(areaId, version, content.Clone(), contentHash));
        }

        return rows.ToImmutable();
    }

    private static bool TryString(JsonElement row, string property, out string value)
    {
        value = string.Empty;
        return row.ValueKind == JsonValueKind.Object &&
               row.TryGetProperty(property, out var element) &&
               element.ValueKind == JsonValueKind.String &&
               (value = element.GetString() ?? string.Empty).Length > 0;
    }

    private static Result<ImmutableArray<T>, WorkspaceReadFailure> Failure<T>(WorkspaceReadFailureKind kind) =>
        Result<ImmutableArray<T>, WorkspaceReadFailure>.Fail(new WorkspaceReadFailure(kind));
}

/// <summary>A small explicit result type for expected infrastructure outcomes.</summary>
public abstract record Result<TValue, TError>
{
    private Result() { }
    public sealed record Success(TValue Value) : Result<TValue, TError>;
    public sealed record Failure(TError Error) : Result<TValue, TError>;

    public static Result<TValue, TError> Succeed(TValue value) => new Result<TValue, TError>.Success(value);
    public static Result<TValue, TError> Fail(TError error) => new Result<TValue, TError>.Failure(error);
}
