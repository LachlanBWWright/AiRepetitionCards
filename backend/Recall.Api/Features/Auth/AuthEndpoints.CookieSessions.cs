using System.Text;
using System.Text.Json;

namespace Recall.Api.Features.Auth;

public static partial class AuthEndpoints
{
    private static string? ReadCookie(HttpRequest request, string baseName)
    {
        var exact = request.Cookies[baseName];
        if (exact is not null) return exact;
        var chunks = request.Cookies
            .Where(pair => pair.Key.StartsWith(baseName + ".", StringComparison.Ordinal))
            .Select(pair =>
            {
                var suffix = pair.Key[(baseName.Length + 1)..];
                var validIndex = int.TryParse(suffix, out var index) && index >= 0;
                return (Name: pair.Key, pair.Value, validIndex, Index: validIndex ? index : -1);
            })
            .OrderBy(pair => pair.Index)
            .ToArray();
        if (chunks.Length == 0 || chunks.Any(chunk => !chunk.validIndex) ||
            chunks.Select(chunk => chunk.Index).Distinct().Count() != chunks.Length || chunks[0].Index != 0) return null;
        var length = 0;
        for (var index = 0; index < chunks.Length; index++)
        {
            if (chunks[index].Index != index) return null;
            length += chunks[index].Value.Length;
            if (length > 65_536) return null;
        }
        return string.Concat(chunks.Select(chunk => chunk.Value));
    }

    private static SessionEnvelope? DecodeSession(string value)
    {
        try
        {
            var encoded = value.StartsWith("base64-", StringComparison.Ordinal) ? value[7..] : value;
            if (encoded.Length > 65_536) return null;
            var json = value.StartsWith("base64-", StringComparison.Ordinal)
                ? Encoding.UTF8.GetString(DecodeBase64Url(encoded))
                : encoded;
            var session = JsonSerializer.Deserialize<SessionEnvelope>(json, JsonOptions);
            if (session is not { AccessToken.Length: > 0 } || session.AccessToken.Length >= 32_768) return null;
            return session.ExpiresAt is null && session.ExpiresIn is > 0
                ? session with { ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + session.ExpiresIn.Value }
                : session;
        }
        catch (FormatException) { return null; }
        catch (JsonException) { return null; }
    }

    private static byte[] DecodeBase64Url(string value)
    {
        var standard = value.Replace('-', '+').Replace('_', '/');
        standard += new string('=', (4 - standard.Length % 4) % 4);
        return Convert.FromBase64String(standard);
    }

    private static void WriteSessionCookies(HttpContext context, SupabaseConfiguration config, SessionEnvelope session)
    {
        var value = "base64-" + Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(session, JsonOptions)))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        ClearSessionCookies(context, config);
        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = config.SecureCookies,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            IsEssential = true,
            Expires = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(session.ExpiresIn ?? 3600, 60, 31_536_000))
        };
        const int chunkSize = 3000;
        if (value.Length <= chunkSize)
        {
            context.Response.Cookies.Append(config.CookieName, value, options);
            return;
        }
        var chunk = 0;
        for (var offset = 0; offset < value.Length; offset += chunkSize)
            context.Response.Cookies.Append($"{config.CookieName}.{chunk++}", value.Substring(offset, Math.Min(chunkSize, value.Length - offset)), options);
    }

    private static void ClearSessionCookies(HttpContext context, SupabaseConfiguration config)
    {
        var names = context.Request.Cookies.Keys
            .Concat(context.Response.Headers.SetCookie.Select(value => value?.Split(';', 2)[0].Split('=', 2)[0]).OfType<string>())
            .Where(name => name == config.CookieName || name.StartsWith(config.CookieName + ".", StringComparison.Ordinal))
            .Distinct(StringComparer.Ordinal);
        foreach (var name in names)
            context.Response.Cookies.Delete(name, new CookieOptions { Path = "/", Secure = config.SecureCookies, HttpOnly = true, SameSite = SameSiteMode.Lax });
    }
}
