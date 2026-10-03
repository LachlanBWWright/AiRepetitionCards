import { observeRoute } from "@/lib/http/observe-route";
import { createHash, randomBytes } from "node:crypto";
import { Effect, Either } from "effect";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createOpenAiSignInProvider } from "@recall/infra-openai";
import { readOpenAiSignInConfiguration } from "@/lib/auth/openai-config";
import { createOpenAiSignInStore } from "@/lib/auth/openai-store";
import { authenticatedOpenAiUser } from "@/lib/auth/openai-session";
import { sharedReturnPathFromQuery } from "@/lib/auth/return-path";

async function handleGET(request: NextRequest): Promise<NextResponse> {
  const configuration = readOpenAiSignInConfiguration();
  const next = sharedReturnPathFromQuery(request.nextUrl.searchParams.getAll("next"));
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
  for (const name of ["__Host-recall-openai", "recall-openai-local"])
    cookieStore.set(name, "", {
      httpOnly: true,
      secure: name.startsWith("__Host-"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  if (!configuration) return redirect("unavailable");
  if (request.nextUrl.origin !== configuration.origin) return redirect("failed");
  const modes = request.nextUrl.searchParams.getAll("mode");
  if (modes.length > 1 || (modes.length === 1 && modes[0] !== "link")) return redirect("failed");
  const mode: "link" | "sign-in" = modes[0] === "link" ? "link" : "sign-in";
  const cookieName = configuration.secureCookie ? "__Host-recall-openai" : "recall-openai-local";
  const result = await Effect.runPromise(
    Effect.either(
      Effect.gen(function* () {
        const linkedUserId = mode === "link" ? yield* authenticatedOpenAiUser(configuration) : null;
        if (mode === "link" && !linkedUserId)
          return yield* Effect.fail({ reason: "sign-in-required" } as const);
        const random = () => randomBytes(32).toString("base64url");
        const browserId = random();
        const codeVerifier = random();
        const transaction = {
          state: random(),
          nonce: random(),
          codeVerifier,
          codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
          redirectUri: configuration.provider.redirectUri,
          mode,
          linkedUserId,
          next,
          createdAt: Date.now(),
        };
        const provider = createOpenAiSignInProvider(configuration.provider);
        const authorizationUrl = yield* provider.authorizationUrl(transaction);
        yield* createOpenAiSignInStore(configuration.store).createTransaction(
          browserId,
          transaction,
        );
        cookieStore.set(cookieName, browserId, {
          httpOnly: true,
          secure: configuration.secureCookie,
          sameSite: "lax",
          path: "/",
          maxAge: 600,
        });
        return authorizationUrl;
      }),
    ),
  );
  if (Either.isLeft(result))
    return redirect(
      result.left.reason === "sign-in-required" ? "sign-in-required" : "temporarily-unavailable",
    );
  const response = NextResponse.redirect(result.right);
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export const GET = observeRoute("openai-sign-in-start", handleGET);
