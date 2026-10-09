namespace Recall.Infrastructure.SupabaseAuth;

/// <summary>Validated settings needed to verify Supabase access tokens.</summary>
public sealed record SupabaseJwtConfiguration(
    string Authority,
    string Issuer,
    string Audience,
    bool RequireHttpsMetadata)
{
    public static bool TryCreate(
        string? projectUrl,
        string? audience,
        bool requireHttpsMetadata,
        out SupabaseJwtConfiguration? configuration)
    {
        configuration = null;

        if (!Uri.TryCreate(projectUrl?.Trim(), UriKind.Absolute, out var uri))
        {
            return false;
        }

        if ((uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            uri.AbsolutePath != "/")
        {
            return false;
        }

        var normalizedAudience = audience?.Trim();
        if (string.IsNullOrEmpty(normalizedAudience))
        {
            return false;
        }

        var issuer = $"{uri.GetLeftPart(UriPartial.Authority)}/auth/v1";
        configuration = new SupabaseJwtConfiguration(
            Authority: issuer,
            Issuer: issuer,
            Audience: normalizedAudience,
            RequireHttpsMetadata: requireHttpsMetadata);
        return true;
    }
}
