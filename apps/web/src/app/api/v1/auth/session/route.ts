import { Effect, Either, Schema } from "effect";
import { AuthSessionResponseSchema } from "@recall/contracts";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { privateJson } from "@/lib/http/private-json";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";

async function handleGET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    return auth.reason === "unavailable" || auth.reason === "workspace-account-changed"
      ? privateJson({ error: auth.reason }, { status: supabaseApiAuthFailureStatus(auth.reason) })
      : privateJson({ schemaVersion: 1, authenticated: false, displayLabel: null, ownerId: null });
  }

  const verified = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => auth.client.auth.getUser(),
        catch: () => ({ _tag: "SessionReadUnavailable" }) as const,
      }),
    ),
  );
  if (
    Either.isLeft(verified) ||
    verified.right.error ||
    verified.right.data.user?.id !== auth.userId
  )
    return privateJson({ error: "session-unavailable" }, { status: 502 });

  const user = verified.right.data.user;
  const email = user.email?.trim();
  const name: unknown = user.user_metadata.name;
  const internalIdentity = email?.toLowerCase().endsWith("@identity.recall.invalid") ?? false;
  const displayLabel =
    email && !internalIdentity
      ? email
      : typeof name === "string" && name.trim().length > 0
        ? name.trim().slice(0, 320)
        : internalIdentity
          ? "ChatGPT account"
          : "Recall account";
  const status = Schema.decodeUnknownEither(AuthSessionResponseSchema)({
    schemaVersion: 1,
    authenticated: true,
    displayLabel,
    ownerId: auth.userId.toLowerCase(),
  });
  return Either.isRight(status)
    ? privateJson(status.right)
    : privateJson({ error: "session-unavailable" }, { status: 502 });
}

export const GET = observeRoute("auth-session-read", handleGET);
