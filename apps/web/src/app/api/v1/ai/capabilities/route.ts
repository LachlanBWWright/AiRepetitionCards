import { Effect, Either, Schema } from "effect";
import { ManagedAiStatusSchema } from "@recall/contracts";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";
import { managedAiRpc } from "@/lib/ai/managed-rpc";
import { privateJson } from "@/lib/http/private-json";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth._tag !== "Authenticated")
    return privateJson({ error: "Sign in to check managed AI access." }, { status: 401 });
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-read", { request });
  if (limited) return limited;
  if (process.env.MANAGED_AI_ENABLED !== "true")
    return privateJson({
      schemaVersion: 1,
      accountId: auth.userId,
      available: false,
      dailyLimitMicrousd: 0,
      usedMicrousd: 0,
      requestLimit: 0,
      requestsUsed: 0,
      expiresAt: null,
    });
  const result = await Effect.runPromise(
    Effect.either(
      managedAiRpc("managed_ai_status", { p_user_id: auth.userId }).pipe(
        Effect.flatMap(Schema.decodeUnknown(ManagedAiStatusSchema)),
      ),
    ),
  );
  return Either.isRight(result)
    ? privateJson(result.right)
    : privateJson({ error: "Managed AI access is temporarily unavailable." }, { status: 503 });
}
