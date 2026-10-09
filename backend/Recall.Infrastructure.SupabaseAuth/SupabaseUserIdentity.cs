using System.Security.Claims;

namespace Recall.Infrastructure.SupabaseAuth;

/// <summary>Stable user identity resolved only from an authenticated JWT principal.</summary>
public sealed record SupabaseUserIdentity(Guid UserId)
{
    public static SupabaseUserIdentity? TryResolve(ClaimsPrincipal verifiedPrincipal)
    {
        if (verifiedPrincipal.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        var subject = verifiedPrincipal.FindFirst("sub")?.Value;
        return Guid.TryParse(subject, out var userId) && userId != Guid.Empty
            ? new SupabaseUserIdentity(userId)
            : null;
    }
}
