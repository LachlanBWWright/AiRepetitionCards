import { Effect, Either, Schema } from "effect";
import type { NextRequest } from "next/server";
import { LuaInvocationSchema } from "@recall/application";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { readJsonBody } from "@/lib/http/read-json";
import { privateJson } from "@/lib/http/private-json";
import { executeLuaInvocation } from "@/lib/learning/lua-runner";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError")
    return privateJson(
      { error: auth.reason },
      { status: supabaseApiAuthFailureStatus(auth.reason) },
    );
  const owner = request.headers.get("x-recall-owner");
  if (owner && owner !== auth.userId)
    return privateJson({ error: "The selected account changed." }, { status: 401 });
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-write", { request });
  if (limited) return limited;
  const input = await Effect.runPromise(
    Effect.either(
      readJsonBody(request, 65536).pipe(Effect.flatMap(Schema.decodeUnknown(LuaInvocationSchema))),
    ),
  );
  if (Either.isLeft(input))
    return privateJson({ error: "Invalid Lua invocation." }, { status: 400 });
  const result = await Effect.runPromise(Effect.either(executeLuaInvocation(input.right)));
  return Either.isLeft(result)
    ? privateJson({ error: result.left.message }, { status: 503 })
    : privateJson(result.right);
}
