import { Effect } from "effect";
import {
  createTutorApi,
  executeBudgetedTutorRequest,
  type TutorHttpRequest,
} from "@recall/application";
import { nativeLocalBudget } from "./native-local-ai-budget";
import * as Crypto from "expo-crypto";
import { withNativeRequest } from "../native-http";

/** Composes the shared tutor API with native bearer authentication and fetch. */
export function makeNativeTutorApi(
  apiUrl: string,
  getAccessToken: () => Promise<string | null>,
  getAccountId: () => string | null,
) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  return createTutorApi((request: TutorHttpRequest) =>
    Effect.gen(function* () {
      const accountId = getAccountId();
      return yield* executeBudgetedTutorRequest(
        request,
        accountId,
        () => sendTutorRequest(request, baseUrl, accountId, getAccessToken, getAccountId),
        { budget: nativeLocalBudget, now: Date.now, createId: Crypto.randomUUID },
      );
    }),
  );
}

function sendTutorRequest(
  request: TutorHttpRequest,
  baseUrl: string,
  accountId: string | null,
  getAccessToken: () => Promise<string | null>,
  getAccountId: () => string | null,
) {
  return Effect.tryPromise({
    try: async () => {
      const token = await getAccessToken();
      if (getAccountId() !== accountId)
        return { status: 401, body: { error: "The selected account changed. Try again." } };
      return await withNativeRequest(
        `${baseUrl}${request.path}`,
        {
          method: request.method,
          headers: {
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
            ...(request.body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        },
        async (response) => {
          try {
            return { status: response.status, body: (await response.json()) as unknown };
          } catch {
            return { status: response.status, body: null };
          }
        },
      );
    },
    catch: () => ({ _tag: "TutorTransportError" }) as const,
  });
}
