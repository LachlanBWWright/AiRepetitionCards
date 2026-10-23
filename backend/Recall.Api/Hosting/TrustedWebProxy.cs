using System.Security.Cryptography;
using System.Text;

namespace Recall.Api.Hosting;

/// <summary>Authenticates the Next.js proxy without trusting arbitrary forwarded hosts.</summary>
public static class TrustedWebProxy
{
    public static IApplicationBuilder UseTrustedWebProxy(this IApplicationBuilder app, IConfiguration configuration)
    {
        var secret = configuration["RECALL_PROXY_SECRET"];
        var configuredOrigin = configuration["RECALL_WEB_ORIGIN"];
        var configured = secret is { Length: >= 32 and <= 256 } &&
            Uri.TryCreate(configuredOrigin, UriKind.Absolute, out var parsed) &&
            parsed.Scheme == Uri.UriSchemeHttps && parsed.UserInfo.Length == 0 &&
            parsed.AbsolutePath == "/" && parsed.Query.Length == 0 && parsed.Fragment.Length == 0;
        var origin = configured ? new Uri(configuredOrigin!) : null;
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(secret ?? ""));
        return app.Use(async (context, next) =>
        {
            var values = context.Request.Headers["x-recall-proxy-key"];
            if (values.Count == 0)
            {
                await next(context);
                return;
            }
            var candidate = values.Count == 1 ? values[0] : null;
            if (origin is null || candidate is not { Length: >= 32 and <= 256 } ||
                !CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(candidate))))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.Headers.CacheControl = "private, no-store";
                return;
            }
            context.Request.Headers.Remove("x-recall-proxy-key");
            context.Request.Scheme = origin.Scheme;
            context.Request.Host = HostString.FromUriComponent(origin);
            await next(context);
        });
    }
}
