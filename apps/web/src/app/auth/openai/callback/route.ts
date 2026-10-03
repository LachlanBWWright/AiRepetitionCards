import { observeRoute } from "@/lib/http/observe-route";
import { timingSafeEqual } from "node:crypto";
import { Effect, Either } from "effect";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createOpenAiSignInProvider } from "@recall/infra-openai";
import { readOpenAiSignInConfiguration } from "@/lib/auth/openai-config";
import { createOpenAiSignInStore } from "@/lib/auth/openai-store";
import { authenticatedOpenAiUser, establishOpenAiSession } from "@/lib/auth/openai-session";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";

async function handleGET(request: NextRequest): Promise<NextResponse> {
  const configuration = readOpenAiSignInConfiguration();
  let next = "/";
  const redirect = (reason: string) => {
    const url = new URL("/sign-in", configuration?.origin ?? request.url);
    url.searchParams.set("openai", reason);
    if (next !== "/") url.searchParams.set("next", next);
    const response = NextResponse.redirect(url);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("referrer-policy", "no-referrer");
    return response;
  };
  const cookieStore = await cookies();
  if (!configuration) {
    for (const name of ["__Host-recall-openai", "recall-openai-local"])
      cookieStore.set(name, "", {
        httpOnly: true,
        secure: name.startsWith("__Host-"),
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    return redirect("unavailable");
  }
  const cookieName = configuration.secureCookie ? "__Host-recall-openai" : "recall-openai-local";
  const browserId = cookieStore.get(cookieName)?.value;
  // Clear the browser binding on every configured callback, including provider cancellation.
  cookieStore.set(cookieName, "", {
    httpOnly: true,
    secure: configuration.secureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  const result = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        if (!browserId || !/^[A-Za-z0-9_-]{43}$/.test(browserId))
          return yield* Effect.fail({ reason: "expired" } as const);
        const transaction = yield* createOpenAiSignInStore(configuration.store).consumeTransaction(
          browserId,
        );
        if (
          !transaction ||
          Date.now() - transaction.createdAt > 600_000 ||
          transaction.createdAt > Date.now() + 5_000 ||
          transaction.redirectUri !== configuration.provider.redirectUri
        )
          return yield* Effect.fail({ reason: "expired" } as const);
        next = sharedPublicationReturnPath(transaction.next);
        const states = request.nextUrl.searchParams.getAll("state");
        const codes = request.nextUrl.searchParams.getAll("code");
        const errors = request.nextUrl.searchParams.getAll("error");
        if (
          request.nextUrl.origin !== configuration.origin ||
          states.length !== 1 ||
          codes.length > 1 ||
          errors.length > 1 ||
          (codes.length === 1 && errors.length === 1)
        )
          return yield* Effect.fail({ reason: "failed" } as const);
        const state = states[0] ?? "";
        if (
          !/^[A-Za-z0-9_-]{43}$/.test(state) ||
          state.length !== transaction.state.length ||
          !timingSafeEqual(Buffer.from(state), Buffer.from(transaction.state))
        )
          return yield* Effect.fail({ reason: "failed" } as const);
        if (errors.length)
          return yield* Effect.fail({
            reason: errors[0] === "access_denied" ? "cancelled" : "failed",
          } as const);
        if (codes.length !== 1 || !codes[0] || codes[0].length > 4096)
          return yield* Effect.fail({ reason: "failed" } as const);
        if (transaction.mode === "link") {
          const currentUserId = yield* authenticatedOpenAiUser(configuration);
          if (!currentUserId || currentUserId !== transaction.linkedUserId)
            return yield* Effect.fail({ reason: "sign-in-required" } as const);
        }
        const identity = yield* createOpenAiSignInProvider(configuration.provider).exchangeIdentity(
          { code: codes[0], transaction },
        );
        yield* establishOpenAiSession(
          configuration,
          identity,
          transaction.mode === "link" ? transaction.linkedUserId : null,
        );
        return transaction.mode;
      }),
    ),
  );
  const safeReasons = ["expired", "failed", "cancelled", "identity-conflict", "sign-in-required"];
  const transientReasons = ["unavailable", "network", "discovery", "configuration"];
  const response = Either.isLeft(result)
    ? redirect(
        transientReasons.includes(result.left.reason)
          ? "temporarily-unavailable"
          : safeReasons.includes(result.left.reason)
            ? result.left.reason
            : "failed",
      )
    : result.right === "link"
      ? redirect("linked")
      : NextResponse.redirect(new URL(next, configuration.origin));
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export const GET = observeRoute("openai-sign-in-callback", handleGET);
