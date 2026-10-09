using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace Recall.Infrastructure.SupabaseAuth;

/// <summary>Registers signature, issuer, and audience verification for Supabase JWTs.</summary>
public static class SupabaseJwtAuthenticationExtensions
{
    public static IServiceCollection AddSupabaseJwtBearer(
        this IServiceCollection services,
        SupabaseJwtConfiguration configuration)
    {
        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                // Request a metadata refresh automatically if Supabase has rotated its signing key.
                options.RefreshOnIssuerKeyNotFound = true;
                options.Authority = configuration.Authority;
                options.Audience = configuration.Audience;
                options.RequireHttpsMetadata = configuration.RequireHttpsMetadata;
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = configuration.Issuer,
                    ValidateAudience = true,
                    ValidAudience = configuration.Audience,
                    ValidateIssuerSigningKey = true,
                    RequireSignedTokens = true,
                    ValidateLifetime = true,
                    NameClaimType = "sub",
                    ClockSkew = TimeSpan.FromSeconds(30)
                };
            });

        return services;
    }
}
