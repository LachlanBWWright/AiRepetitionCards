import { Effect, Either, Schema } from "effect";
import type { NextRequest } from "next/server";
import { validateStudySettings } from "@recall/application";
import {
  WorkspaceStudyPageSchema,
  WorkspaceStudyBatchSchema,
  WorkspaceStudyBatchReplySchema,
} from "@recall/contracts";
import { workspaceStudyPageRequest } from "@recall/infra-supabase/study-sync";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { privateJson } from "@/lib/http/private-json";
import { readJsonBody } from "@/lib/http/read-json";
import { observeRoute } from "@/lib/http/observe-route";
const RequestSchema = WorkspaceStudyBatchSchema;

async function handle(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return privateJson(
      { error: auth.reason },
      { status: supabaseApiAuthFailureStatus(auth.reason) },
    );
  const limited = await authenticatedApiRateLimit(auth.userId, "study-pages", { request });
  if (limited) return limited;
  const operation = Effect.gen(function* () {
    if (request.method === "GET") {
      const after = Number(request.nextUrl.searchParams.get("after") ?? "0");
      if (!Number.isSafeInteger(after) || after < 0)
        return yield* Effect.fail({ message: "invalid-request" });
      return yield* workspaceStudyPageRequest(auth.client, { after });
    }
    const raw = yield* readJsonBody(request, 5_000_000).pipe(
      Effect.mapError(() => ({ message: "invalid-request" })),
    );
    const input = yield* Schema.decodeUnknown(RequestSchema)(raw).pipe(
      Effect.mapError(() => ({ message: "invalid-request" })),
    );
    yield* validateStudySettings(input.document.settings).pipe(
      Effect.mapError(() => ({ message: "invalid-request" })),
    );
    const document = yield* toDatabaseJson(input.document).pipe(
      Effect.mapError(() => ({ message: "invalid-request" })),
    );
    return yield* workspaceStudyPageRequest(auth.client, { revision: input.revision, document });
  });
  const result = await Effect.runPromise(Effect.either(operation));
  if (Either.isLeft(result))
    return privateJson(
      { error: result.left.message },
      { status: result.left.message === "invalid-request" ? 400 : 502 },
    );
  if (result.right === null) return privateJson({ error: "study-conflict" }, { status: 409 });
  const decoded =
    request.method === "GET"
      ? Schema.decodeUnknownEither(WorkspaceStudyPageSchema)(result.right)
      : Schema.decodeUnknownEither(WorkspaceStudyBatchReplySchema)(result.right);
  return Either.isLeft(decoded)
    ? privateJson({ error: "invalid-study-response" }, { status: 502 })
    : privateJson(decoded.right);
}
export const GET = observeRoute("workspace-study-read", handle);
export const POST = observeRoute("workspace-study-write", handle);
