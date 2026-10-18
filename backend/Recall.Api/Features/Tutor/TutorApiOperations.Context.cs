using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Recall.Api.Features.Tutor;

public sealed partial class TutorApiOperations
{
    private async Task<ActionContextResolution> ResolveActionContextAsync(
        SupabaseApiRequestContext context,
        Guid? sessionId,
        Guid? areaId,
        string fingerprint,
        IReadOnlyList<TutorHistoryEntry> suppliedHistory,
        CancellationToken token)
    {
        if (sessionId is Guid id)
        {
            var sessions = await GetRowsAsync(context,
                $"tutor_sessions?select=area_id,area_snapshot&id=eq.{id:D}&user_id=eq.{context.UserId:D}&limit=1", token);
            if (sessions is null) return new ActionContextResolution.Failure("tutor-storage-unavailable", 502);
            if (sessions.Value.GetArrayLength() == 0) return new ActionContextResolution.Failure("session-not-found", 404);
            var row = sessions.Value[0];
            if (!row.TryGetProperty("area_id", out var areaIdValue) || areaIdValue.ValueKind != JsonValueKind.String ||
                !TryUuid(areaIdValue.GetString(), out var savedAreaId) ||
                !row.TryGetProperty("area_snapshot", out var savedArea) || !TryValidateKnowledgeArea(savedArea))
                return new ActionContextResolution.Failure("tutor-storage-unavailable", 502);
            if (areaId is Guid assertedArea && assertedArea != savedAreaId)
                return new ActionContextResolution.Failure("session-area-mismatch", 409);
            var messages = await GetRowsAsync(context,
                $"tutor_messages?select=role,kind,content&session_id=eq.{id:D}&user_id=eq.{context.UserId:D}&kind=in.(question,answer,feedback)&order=sequence.desc,id.desc&limit=40", token);
            if (messages is null) return new ActionContextResolution.Failure("tutor-storage-unavailable", 502);
            var history = new List<TutorHistoryEntry>();
            foreach (var message in messages.Value.EnumerateArray())
            {
                if (!TryString(message, "role", out var role) || !TryString(message, "kind", out var kind) ||
                    !TryString(message, "content", out var content) || role is not ("tutor" or "learner") ||
                    kind is not ("question" or "answer" or "feedback"))
                    return new ActionContextResolution.Failure("tutor-storage-unavailable", 502);
                if (role == "learner" && kind == "answer" || role == "tutor" && kind is "question" or "feedback")
                    history.Add(new TutorHistoryEntry(role == "tutor" ? "assistant" : "learner", content));
            }
            history.Reverse();
            return new ActionContextResolution.Success(new ResolvedActionContext(savedAreaId, savedArea.Clone(), history, id));
        }
        if (areaId is not Guid ownerAreaId || ownerAreaId == Guid.Empty)
            return new ActionContextResolution.Failure("invalid-request", 400);
        var canonicalResult = await ReadCanonicalAreaAsync(context, ownerAreaId, token);
        if (canonicalResult.Failure is not null) return new ActionContextResolution.Failure(canonicalResult.Failure, canonicalResult.Status);
        var canonical = canonicalResult.Area!.Value;
        if (fingerprint.Length > 0 && Fingerprint(canonical) != fingerprint)
            return new ActionContextResolution.Failure("area-changed", 409);
        return new ActionContextResolution.Success(new ResolvedActionContext(ownerAreaId, canonical.Clone(), suppliedHistory, null));
    }

    private async Task<CanonicalAreaReadResult> ReadCanonicalAreaAsync(
        SupabaseApiRequestContext context,
        Guid areaId,
        CancellationToken token)
    {
        var owners = await GetRowsAsync(context,
            $"knowledge_areas?select=id&id=eq.{areaId:D}&owner_id=eq.{context.UserId:D}&deleted_at=is.null&limit=1", token);
        if (owners is null) return new(null, "tutor-storage-unavailable", 502);
        if (owners.Value.GetArrayLength() != 1) return new(null, "area-not-found", 409);
        var versions = await GetRowsAsync(context,
            $"knowledge_area_versions?select=content&knowledge_area_id=eq.{areaId:D}&order=version.desc&limit=1", token);
        if (versions is null) return new(null, "tutor-storage-unavailable", 502);
        if (versions.Value.GetArrayLength() != 1 || !versions.Value[0].TryGetProperty("content", out var area) || area.ValueKind != JsonValueKind.Object ||
            !TryString(area, "id", out var canonicalId) || !TryUuid(canonicalId, out var parsedId) || parsedId != areaId ||
            !TryValidateKnowledgeArea(area))
            return new(null, "area-not-found", 409);
        return new(area.Clone(), null, 200);
    }

    private static IResult? ContextFailure(ActionContextResolution result) => result is ActionContextResolution.Failure failure
        ? Error(failure.Code, failure.Status)
        : null;
}
