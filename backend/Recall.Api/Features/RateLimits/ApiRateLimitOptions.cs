using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Recall.Api.Features.RateLimits;

public enum ApiRateLimitScope
{
    ReviewSync,
    WorkspaceSync,
    TutorRead,
    TutorWrite,
    AccountOperations,
    PrivacyPolicyRead,
    PrivateMediaRead,
    PrivateMediaWrite,
    PublicationWrite,
    PublicPublicationRead
}

public sealed record ApiRateLimitPolicy(int Requests, TimeSpan Window)
{
    public static bool TryGet(ApiRateLimitScope scope, out ApiRateLimitPolicy policy)
    {
        policy = scope switch
        {
            ApiRateLimitScope.ReviewSync => new(120, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.WorkspaceSync => new(30, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.TutorRead => new(60, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.TutorWrite => new(20, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.AccountOperations => new(30, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.PrivacyPolicyRead => new(60, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.PrivateMediaRead => new(120, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.PrivateMediaWrite => new(120, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.PublicationWrite => new(30, TimeSpan.FromMinutes(1)),
            ApiRateLimitScope.PublicPublicationRead => new(120, TimeSpan.FromMinutes(1)),
            _ => new(0, TimeSpan.Zero)
        };
        return policy.Requests > 0;
    }
}

internal static class ApiRateLimitScopeCompatibility
{
    public static string ContractName(ApiRateLimitScope scope) => scope switch
    {
        ApiRateLimitScope.ReviewSync or ApiRateLimitScope.PrivateMediaRead or ApiRateLimitScope.PrivateMediaWrite or ApiRateLimitScope.PublicPublicationRead => "review-sync",
        ApiRateLimitScope.WorkspaceSync or ApiRateLimitScope.AccountOperations or ApiRateLimitScope.PublicationWrite => "workspace-sync",
        ApiRateLimitScope.TutorRead or ApiRateLimitScope.PrivacyPolicyRead => "tutor-read",
        ApiRateLimitScope.TutorWrite => "tutor-write",
        _ => ""
    };

    public static string SubjectNamespace(string? value) => value is "review-sync" or "workspace-sync" ? "" : value ?? "";
}

public sealed record ApiRateLimitDecision(bool Allowed, int Remaining, int RetryAfterSeconds);

/// <summary>Endpoint metadata consumed by ApiRateLimitMiddleware before body binding.</summary>
public sealed record ApiRateLimitMetadata(
    ApiRateLimitScope Scope,
    string? Namespace = null,
    bool Publication = false,
    bool IncludeTrustedIp = false,
    bool Anonymous = false);

public sealed class ApiRateLimitConfiguration
{
    public string Mode { get; init; } = "";
    public string? RestUrl { get; init; }
    public string? RestToken { get; init; }
    public string Prefix { get; init; } = "recall:api-rate-limit";
    public string? TrustedIpHeader { get; init; }
    public string? IpHmacSecret { get; init; }
    public bool IsDevelopment { get; init; }
}

internal static class RateLimitSubject
{
    public static string Hmac(string value, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes(value)));
    }

    public static bool TryCanonicalIp(string value, out string canonical)
    {
        canonical = "";
        value = value.Trim();
        if (value.Length is < 2 or > 45 || value.Contains('%') || value.Contains(',') || value.Contains('[') || value.Contains(']') ||
            value.Any(character => !(char.IsAsciiDigit(character) || character is >= 'a' and <= 'f' or >= 'A' and <= 'F' or ':' or '.')))
            return false;

        if (!value.Contains(':'))
        {
            var octets = value.Split('.');
            if (octets.Length != 4 || octets.Any(octet => octet.Length is < 1 or > 3 ||
                octet.Length > 1 && octet[0] == '0' ||
                !byte.TryParse(octet, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out _)))
                return false;
            canonical = "ipv4:" + string.Join('.', octets.Select(octet => byte.Parse(octet, System.Globalization.CultureInfo.InvariantCulture)));
            return true;
        }

        if (!IPAddress.TryParse(value, out var address) || address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6)
            return false;
        if (address.IsIPv4MappedToIPv6)
        {
            var mapped = address.MapToIPv4().GetAddressBytes();
            canonical = $"ipv4:{mapped[0]}.{mapped[1]}.{mapped[2]}.{mapped[3]}";
            return true;
        }
        var bytes = address.GetAddressBytes();
        var groups = new string[8];
        for (var index = 0; index < groups.Length; index++)
            groups[index] = ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).ToString("x4", System.Globalization.CultureInfo.InvariantCulture);
        canonical = "ipv6:" + string.Join(':', groups);
        return true;
    }
}
