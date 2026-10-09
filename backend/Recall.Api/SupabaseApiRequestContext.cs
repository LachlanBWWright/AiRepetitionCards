using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Recall.Infrastructure.SupabaseAuth;

internal sealed record SupabaseApiRequestContext(
    Uri ProjectUrl,
    string PublishableKey,
    string AccessToken,
    Guid UserId)
{
    public static async Task<SupabaseApiRequestResult> ResolveAsync(
        HttpContext httpContext,
        IConfiguration configuration)
    {
        var projectUrl = (configuration["SUPABASE_URL"] ?? configuration["NEXT_PUBLIC_SUPABASE_URL"])?.Trim();
        var publishableKey = (configuration["SUPABASE_PUBLISHABLE_KEY"] ?? configuration["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])?.Trim();
        if (!Uri.TryCreate(projectUrl, UriKind.Absolute, out var projectUri) ||
            string.IsNullOrWhiteSpace(publishableKey) ||
            (projectUri.Scheme != Uri.UriSchemeHttps && projectUri.Host != "localhost"))
        {
            return new SupabaseApiRequestResult.Unavailable();
        }

        AuthenticateResult authentication;
        try
        {
            authentication = await httpContext.AuthenticateAsync(JwtBearerDefaults.AuthenticationScheme);
        }
        catch (InvalidOperationException)
        {
            // Supabase API credentials can be present while JWT validation is misconfigured.
            // Next's auth adapter classifies this as an unavailable auth context, not a 500.
            return new SupabaseApiRequestResult.Unavailable();
        }
        if (!authentication.Succeeded || authentication.Principal is null)
        {
            return new SupabaseApiRequestResult.Unauthenticated();
        }

        var identity = SupabaseUserIdentity.TryResolve(authentication.Principal);
        var authorization = httpContext.Request.Headers.Authorization.ToString();
        var accessToken = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? authorization[7..].Trim()
            : string.Empty;
        if (identity is null || string.IsNullOrWhiteSpace(accessToken))
        {
            return new SupabaseApiRequestResult.Unauthenticated();
        }

        return new SupabaseApiRequestResult.Authenticated(
            new SupabaseApiRequestContext(projectUri, publishableKey, accessToken, identity.UserId));
    }
}

internal abstract record SupabaseApiRequestResult
{
    private SupabaseApiRequestResult() { }

    internal sealed record Authenticated(SupabaseApiRequestContext Context) : SupabaseApiRequestResult;
    internal sealed record Unauthenticated : SupabaseApiRequestResult;
    internal sealed record Unavailable : SupabaseApiRequestResult;
}
