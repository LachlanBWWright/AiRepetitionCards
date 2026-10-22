using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Recall.Api;

/// <summary>
/// Documents the wire-level surface of the current v1 handlers. The application
/// still validates the authoritative discriminated payloads at runtime; schemas
/// marked open here intentionally avoid claiming a narrower contract than the
/// TypeScript validators currently guarantee.
/// </summary>
public sealed class ApiContractOperationFilter : IOperationFilter
{
    private static readonly OpenApiSchema OpenJsonObject = new()
    {
        Type = JsonSchemaType.Object,
        AdditionalPropertiesAllowed = true,
        Description = "JSON object. The endpoint validates its operation-specific shape; see contracts/ and docs/dotnet-contract-bridge.md."
    };

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var path = "/" + (context.ApiDescription.RelativePath ?? string.Empty).Trim('/');
        var method = context.ApiDescription.HttpMethod?.ToUpperInvariant() ?? "GET";
        operation.Summary ??= $"{method} {path}";

        AddRelevantParameters(operation, path, method);
        AddRequestBody(operation, path, method);
        AddResponses(operation, path, method);

        if (RequiresBearer(path, method))
        {
            operation.Security ??= new List<OpenApiSecurityRequirement>();
            operation.Security.Add(new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference("Bearer", context.Document)] = new List<string>()
            });
            if (AcceptsSsrCookie(path))
            {
                operation.Security.Add(new OpenApiSecurityRequirement
                {
                    [new OpenApiSecuritySchemeReference("SupabaseSessionCookie", context.Document)] = new List<string>()
                });
            }
        }
    }

    private static void AddRequestBody(OpenApiOperation operation, string path, string method)
    {
        if (method is not ("POST" or "PATCH" or "DELETE")) return;
        if (path == "/auth/sign-out" || path == "/api/internal/tutor-retention") return;

        if (path is "/api/v1/publishing/media/{mediaId}" or "/api/v1/workspace/media/{mediaId}")
        {
            operation.RequestBody = new OpenApiRequestBody
            {
                Required = true,
                Description = "Raw media bytes. The `x-recall-media-reference` header contains the JSON-encoded media reference used to validate the bytes.",
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["application/octet-stream"] = new() { Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary" } }
                }
            };
            return;
        }

        var description = path switch
        {
            "/api/v1/workspace" => "Workspace snapshot: schemaVersion, areas, and optional tombstones. Each area contains the document and color; optional baseContentHash supports conflict detection.",
            "/api/v1/sync" when method == "POST" => "Review-event push envelope. The versioned operation records are validated by the v1 sync contract.",
            "/api/v1/sync" => "Review-event pull requests are sent as query parameters; this body is ignored.",
            "/api/v1/knowledge-areas" => "Publication creation request. Includes the source area, schemaVersion, visibility and rights metadata; validated before saving.",
            "/api/v1/published/{versionId}/fork" => "Fork request with an operation id and optional share token.",
            "/api/v1/published/{versionId}/token" => "Share-token action request. Supported actions are defined by the publication token contract.",
            "/api/v1/decks/{deckId}" when method == "PATCH" => "Selective shared-deck metadata and status fields.",
            "/api/v1/decks/{deckId}/feedback" => "Feedback item with id, versionId, optional cardId, message, and kind.",
            "/api/v1/decks/{deckId}/feedback/{feedbackId}" => "Feedback status update: open or resolved.",
            "/api/v1/deck-subscriptions" => "Subscription source and following state.",
            "/api/v1/deck-subscriptions/{areaId}/updates/read" => "Acknowledges the supplied latest public version for this followed deck. Body: { versionId }.",
            "/api/v1/decks/{deckId}/reports" => "Idempotent report request: { id, versionId, reason, message, token? }. Reasons: spam, harmful, copyright, or broken.",
            "/api/v1/decks/{deckId}/block" => "Optional JSON body { token } supplies the exact unlisted-link capability when blocking or unblocking its publisher.",
            "/api/v1/moderation/decks/{deckId}" => "Operator-only moderation action: { status: visible|hidden, reason }. Owner publication status is unchanged.",
            "/api/v1/moderation/reports/{reportId}" => "Operator-only report status action: { status: open|resolved }.",
            "/api/v1/activities" => "Per-user activity snapshot read or revision-checked replacement. Authenticated workspace owner required.",
            "/api/v1/activities/assess" => "Assessment request with activity snapshot and learner response; validates synced activity revision before evaluation.",
            "/api/v1/activities/question" => "Adaptive question request with activity snapshot and answer sequence; validates synced activity revision before evaluation.",
            "/api/v1/account/delete" => "Account-deletion confirmation request. Exact confirmation text is required.",
            "/api/v1/workspace/review-identities" => "Review identity lookup request containing the requested identifiers.",
            "/api/v1/workspace/area-tombstones" => "Area tombstone deletion request with the schemaVersion and tombstone operations.",
            "/api/v1/tutor" when method == "PATCH" => "Tutor proposal-resolution request. The action and proposal identifiers are validated against the active session.",
            "/api/v1/tutor" => "Tutor action request. This endpoint accepts several discriminated actions; see the tutor v1 contract.",
            "/api/v1/tutor/privacy" => "Confirmation request required to delete hosted tutor history.",
            _ => "JSON request body. The endpoint validates its operation-specific shape; see contracts/ and docs/dotnet-contract-bridge.md."
        };

        operation.RequestBody = new OpenApiRequestBody
        {
            Required = method is "POST" or "PATCH",
            Description = description,
            Content = new Dictionary<string, OpenApiMediaType>
            {
                ["application/json"] = new() { Schema = OpenJsonObject }
            }
        };
    }

    private static void AddRelevantParameters(OpenApiOperation operation, string path, string method)
    {
        if (path == "/api/v1/sync" && method == "GET")
        {
            AddQuery(operation, "cursor", "Opaque review-sync cursor; omit to start from the current client position.");
        }
        if (path == "/api/v1/tutor" && method == "GET")
            AddQuery(operation, "sessionId", "Tutor session identifier to read.", required: true);
        if (path == "/api/v1/published/{versionId}")
            AddQuery(operation, "token", "Share token for an unlisted publication.");
        if (path == "/api/v1/published/{versionId}/updates")
        {
            AddQuery(operation, "sourceAreaId", "Optional source knowledge-area id used to filter updates.");
            AddQuery(operation, "token", "Share token for an unlisted publication.");
        }
        if (path == "/api/v1/published/{versionId}/fork")
            AddQuery(operation, "token", "Optional share token for the source publication.");
        if (path is "/api/v1/decks" or "/api/v1/decks/{deckId}")
        {
            if (path == "/api/v1/decks")
            {
                AddQuery(operation, "q", "Optional title or description search.");
                AddQuery(operation, "language", "Optional language filter.");
                AddQuery(operation, "tag", "Optional exact tag filter.");
                AddQuery(operation, "difficulty", "Optional author-declared difficulty: beginner, intermediate, or advanced.");
                AddQuery(operation, "activityType", "Optional exact activity plugin type filter (case-insensitive; max 200 characters).");
                AddQuery(operation, "minMinutes", "Optional lower bound for estimated study time, from 1 to 1000 minutes. Must not exceed maxMinutes.", minimum: 1, maximum: 1000);
                AddQuery(operation, "maxMinutes", "Optional upper bound for estimated study time, from 1 to 1000 minutes. Must not be below minMinutes.", minimum: 1, maximum: 1000);
                AddQuery(operation, "limit", "Page size from 1 to 50; defaults to 20.");
                AddQuery(operation, "cursor", "Last deck UUID from the prior page.");
            }
            else AddQuery(operation, "token", "Optional exact share token for an unlisted deck.");
        }
        if (path == "/auth/confirm")
        {
            AddQuery(operation, "token_hash", "Supabase email confirmation token hash.", required: true);
            AddQuery(operation, "type", "Confirmation type; email confirmation uses `email`.", required: true);
            AddQuery(operation, "next", "Optional same-origin return path.");
        }
        if (path == "/auth/openai")
        {
            AddQuery(operation, "mode", "Optional `link` to link an OpenAI identity to the signed-in account.");
            AddQuery(operation, "next", "Optional same-origin return path.");
        }
        if (path == "/auth/openai/callback")
        {
            AddQuery(operation, "state", "OAuth state issued by the sign-in start endpoint.", required: true);
            AddQuery(operation, "code", "Authorization code returned by the identity provider.");
            AddQuery(operation, "error", "OAuth error returned by the identity provider.");
        }
        if (path is "/api/v1/publishing/media/{mediaId}" or "/api/v1/workspace/media/{mediaId}")
            AddHeader(operation, "x-recall-media-reference", "JSON-encoded media reference validated against the uploaded bytes.", required: true);
        if (path == "/api/v1/auth/session" || path == "/api/v1/workspace" || path.StartsWith("/api/v1/account/", StringComparison.Ordinal) || path == "/api/v1/sync")
            AddHeader(operation, "x-recall-workspace-owner", "Optional expected owner id; a mismatch returns 409 workspace-account-changed.");
        if (path.StartsWith("/api/v1/decks/", StringComparison.Ordinal) || path.StartsWith("/api/v1/deck-subscriptions", StringComparison.Ordinal))
            AddHeader(operation, "x-recall-owner", "Optional expected authenticated owner id; a mismatch returns 401.");
    }

    private static void AddQuery(OpenApiOperation operation, string name, string description, bool required = false, int? minimum = null, int? maximum = null)
    {
        operation.Parameters ??= [];
        var schema = new OpenApiSchema { Type = minimum.HasValue || maximum.HasValue ? JsonSchemaType.Integer : JsonSchemaType.String };
        if (minimum.HasValue) schema.Minimum = minimum.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (maximum.HasValue) schema.Maximum = maximum.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = name,
            In = ParameterLocation.Query,
            Required = required,
            Description = description,
            Schema = schema
        });
    }

    private static void AddHeader(OpenApiOperation operation, string name, string description, bool required = false)
    {
        operation.Parameters ??= [];
        operation.Parameters.Add(new OpenApiParameter
        {
            Name = name,
            In = ParameterLocation.Header,
            Required = required,
            Description = description,
            Schema = new OpenApiSchema { Type = JsonSchemaType.String }
        });
    }

    private static void AddResponses(OpenApiOperation operation, string path, string method)
    {
        var successCodes = SuccessCodes(path, method);
        var errorCodes = ErrorCodes(path, method);
        var responses = new OpenApiResponses();
        foreach (var code in successCodes)
        {
            var response = new OpenApiResponse { Description = SuccessDescription(path, method, code) };
            if (method != "HEAD" && code is not ("302" or "303" or "307"))
            {
                response.Content ??= new Dictionary<string, OpenApiMediaType>();
                if (IsBinary(path))
                {
                    foreach (var mime in MediaMimeTypes)
                        response.Content[mime] = new OpenApiMediaType { Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary" } };
                }
                else
                {
                    response.Content["application/json"] = new OpenApiMediaType { Schema = JsonResponseSchema(path, method) };
                }
            }
            if (code is "302" or "303" or "307")
            {
                response.Headers ??= new Dictionary<string, IOpenApiHeader>();
                response.Headers["Location"] = new OpenApiHeader { Description = "Redirect destination", Schema = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uri-reference" } };
            }
            responses[code] = response;
        }

        foreach (var code in errorCodes)
        {
            responses[code] = new OpenApiResponse
            {
                Description = ErrorDescription(code),
                Content = new Dictionary<string, OpenApiMediaType>
                {
                    ["application/json"] = new OpenApiMediaType { Schema = ErrorSchema(path, code) }
                }
            };
        }
        operation.Responses = responses;
    }

    private static OpenApiSchema JsonResponseSchema(string path, string method)
    {
        if (path == "/health")
            return new OpenApiSchema { Type = JsonSchemaType.Object, Required = new HashSet<string> { "status" }, Properties = new Dictionary<string, IOpenApiSchema> { ["status"] = new OpenApiSchema { Type = JsonSchemaType.String, Const = "ok" } } };
        if (path == "/api/v1/auth/openai/capabilities")
            return new OpenApiSchema { Type = JsonSchemaType.Object, Required = new HashSet<string> { "enabled", "linkingAvailable" }, Properties = new Dictionary<string, IOpenApiSchema> { ["enabled"] = new OpenApiSchema { Type = JsonSchemaType.Boolean }, ["linkingAvailable"] = new OpenApiSchema { Type = JsonSchemaType.Boolean } } };
        if (path == "/api/v1/auth/session")
            return new OpenApiSchema { Type = JsonSchemaType.Object, Description = "AuthSessionResponseSchema from @recall/contracts; anonymous and authenticated fixture examples are in contracts/fixtures/dotnet-v1/.", AdditionalPropertiesAllowed = true };
        if (path.StartsWith("/api/v1/published/") && path.EndsWith("/media/{mediaId}")) return OpenJsonObject;
        return new OpenApiSchema
        {
            Type = JsonSchemaType.Object,
            AdditionalPropertiesAllowed = true,
            Description = "Endpoint-specific response validated by the corresponding v1 TypeScript contract. See contracts/fixtures/dotnet-v1/ and docs/dotnet-contract-bridge.md; properties are intentionally open here."
        };
    }

    private static OpenApiSchema ErrorSchema() => new()
    {
        Type = JsonSchemaType.Object,
        Required = new HashSet<string> { "error" },
        Properties = new Dictionary<string, IOpenApiSchema> { ["error"] = new OpenApiSchema { Type = JsonSchemaType.String, Description = "Stable machine-readable error code. The allowed codes vary by operation." } },
        AdditionalPropertiesAllowed = false,
        Description = "Common API error envelope."
    };

    private static OpenApiSchema ErrorSchema(string path, string statusCode)
    {
        if (path == "/api/v1/auth/session" && statusCode == "502")
            return new OpenApiSchema
            {
                Type = JsonSchemaType.Object,
                Required = new HashSet<string> { "title", "status" },
                Properties = new Dictionary<string, IOpenApiSchema>
                {
                    ["type"] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "uri" },
                    ["title"] = new OpenApiSchema { Type = JsonSchemaType.String, Const = "session-unavailable" },
                    ["status"] = new OpenApiSchema { Type = JsonSchemaType.Integer, Description = "Always 502 for this problem response." }
                },
                Description = "RFC 9457 Problem Details response emitted by the Supabase session lookup."
            };
        if (path.StartsWith("/api/v1/knowledge-areas", StringComparison.Ordinal) || path.StartsWith("/api/v1/published/", StringComparison.Ordinal) || path.StartsWith("/api/v1/publishing/", StringComparison.Ordinal))
        {
            var schema = ErrorSchema();
            schema.Properties!["schemaVersion"] = new OpenApiSchema { Type = JsonSchemaType.Integer, Description = "Schema version; currently 1." };
            schema.AdditionalPropertiesAllowed = false;
            return schema;
        }
        return ErrorSchema();
    }

    private static readonly string[] MediaMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "audio/mpeg", "audio/ogg", "audio/wav", "audio/mp4", "audio/webm"];

    private static string[] SuccessCodes(string path, string method) => path switch
    {
        "/api/v1/knowledge-areas" => ["200", "201"],
        "/api/v1/publishing/media/{mediaId}" or "/api/v1/workspace/media/{mediaId}" when method == "POST" => ["200", "201"],
        "/api/v1/published/{versionId}/fork" => ["200", "201"],
        "/auth/sign-out" => ["303"],
        "/auth/confirm" or "/auth/openai" or "/auth/openai/callback" => ["302"],
        "/api/internal/tutor-retention" when method == "HEAD" => ["405"],
        _ => ["200"]
    };

    private static string[] ErrorCodes(string path, string method) => path switch
    {
        "/health" or "/api/v1/auth/openai/capabilities" => [],
        "/api/v1/published/{versionId}" when method == "GET" => ["404", "503"],
        "/api/v1/auth/session" => ["409", "502", "503"],
        "/api/v1/workspace" when method == "GET" => ["401", "409", "502", "503"],
        "/api/v1/sync" => ["400", "401", "409", "413", "502", "503"],
        "/api/v1/workspace" when method == "POST" => ["400", "401", "409", "413", "502", "503"],
        "/api/v1/account/export" => ["401", "502"],
        "/api/v1/account/delete" => ["400", "401", "403", "409", "413", "502", "503"],
        "/api/v1/tutor" => ["400", "401", "404", "409", "413", "429", "502", "503"],
        "/api/v1/tutor/privacy" => ["400", "401", "403", "413", "502", "503"],
        "/api/internal/tutor-retention" when method == "HEAD" => [],
        "/api/internal/tutor-retention" => ["401", "502", "503"],
        "/auth/confirm" or "/auth/openai" or "/auth/openai/callback" => [],
        "/api/v1/knowledge-areas" or "/api/v1/published/{versionId}/fork" or "/api/v1/published/{versionId}/token" => ["400", "401", "404", "409", "413", "422", "502", "503"],
        "/api/v1/publishing/media/{mediaId}" or "/api/v1/workspace/media/{mediaId}" => ["400", "401", "404", "409", "413", "415", "422", "502", "503"],
        "/api/v1/published/{versionId}/media/{mediaId}" => ["404", "503"],
        "/api/v1/published/{versionId}/updates" => ["400", "404", "503"],
        "/api/v1/deck-subscriptions/updates" => ["401", "502", "503"],
        "/api/v1/deck-subscriptions/{areaId}/updates/read" => ["400", "401", "404", "409", "502", "503"],
        "/api/v1/decks/{deckId}/reports" => ["400", "401", "404", "409", "413", "429", "502", "503"],
        "/api/v1/decks/{deckId}/block" => ["400", "401", "404", "413", "429", "502", "503"],
        "/api/v1/moderation/reports" or "/api/v1/moderation/decks/{deckId}" or "/api/v1/moderation/reports/{reportId}" => ["400", "401", "403", "404", "409", "413", "429", "502", "503"],
        "/api/v1/activities" => ["400", "401", "409", "413", "502", "503"],
        "/api/v1/activities/assess" or "/api/v1/activities/question" => ["400", "401", "409", "413", "429", "502", "503"],
        "/api/v1/workspace/review-identities" or "/api/v1/workspace/area-tombstones" => ["400", "401", "409", "413", "502", "503"],
        _ => ["400", "401", "403", "404", "409", "413", "429", "502", "503"]
    };

    private static string SuccessDescription(string path, string method, string code) => code switch
    {
        "201" => "Created; idempotent replay may return 200.",
        "302" => "Redirect to the sign-in provider or safe application return path.",
        "303" => "Sign-out completed; Location points to the next page.",
        "405" => "Method not supported; Allow identifies supported methods.",
        _ when IsBinary(path) => "Media bytes; Content-Type is the validated media MIME type.",
        _ => "Successful operation. JSON properties follow the corresponding v1 contract; see docs/dotnet-contract-bridge.md."
    };

    private static string ErrorDescription(string code) => code switch
    {
        "400" => "Invalid request or operation-specific validation failed.",
        "401" => "Authentication is missing or invalid.",
        "403" => "Request origin or authorization is not permitted.",
        "404" => "The requested resource was not found.",
        "409" => "The operation conflicts with current account or resource state.",
        "413" => "Request exceeds the endpoint size limit.",
        "415" => "Unsupported media type.",
        "422" => "Media or publication content failed integrity validation.",
        "429" => "Rate or provider quota limit reached.",
        "502" => "An upstream provider or stored response failed.",
        "503" => "The feature is unavailable or is not configured.",
        _ => "Operation failed."
    };

    private static bool IsBinary(string path) => path is "/api/v1/published/{versionId}/media/{mediaId}" or "/api/v1/workspace/media/{mediaId}";

    private static bool RequiresBearer(string path, string method) =>
        path.StartsWith("/api/v1/account/", StringComparison.Ordinal) ||
        path.StartsWith("/api/v1/workspace", StringComparison.Ordinal) ||
        path == "/api/v1/sync" || path == "/api/v1/tutor" || path == "/api/v1/tutor/privacy" ||
        path == "/api/v1/knowledge-areas" || path == "/api/v1/published/{versionId}/fork" ||
        path == "/api/v1/published/{versionId}/token" || path == "/api/v1/publishing/media/{mediaId}" ||
        path == "/api/v1/decks/mine" ||
        path == "/api/v1/decks/{deckId}/reports" || path == "/api/v1/decks/{deckId}/block" ||
        path.StartsWith("/api/v1/moderation/", StringComparison.Ordinal) || path.StartsWith("/api/v1/activities", StringComparison.Ordinal) ||
        path == "/api/v1/deck-subscriptions/updates" || path == "/api/v1/deck-subscriptions/{areaId}/updates/read" ||
        (path == "/api/v1/deck-subscriptions" && (method is "PUT" or "DELETE")) || path == "/api/v1/deck-subscriptions/{areaId}" ||
        (path == "/api/v1/decks/{deckId}" && method == "PATCH") || (path == "/api/v1/decks/{deckId}/feedback" && method == "POST") ||
        path == "/api/v1/decks/{deckId}/feedback/{feedbackId}";

    private static bool AcceptsSsrCookie(string path) =>
        path.StartsWith("/api/v1/account/", StringComparison.Ordinal) ||
        path.StartsWith("/api/v1/workspace", StringComparison.Ordinal) ||
        path == "/api/v1/sync" || path == "/api/v1/tutor" || path == "/api/v1/tutor/privacy";
}
