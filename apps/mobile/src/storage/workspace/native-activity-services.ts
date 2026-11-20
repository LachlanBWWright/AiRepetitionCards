import { readNativeAiFunding } from "../ai/native-managed-ai";
import * as Crypto from "expo-crypto";
import { Effect } from "effect";
import { createActivityServices, type ActivityFailure } from "@recall/application";
import { withNativeRequest } from "../native-http";
export function createNativeActivityServices(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
  expectedOwner?: string,
) {
  return createActivityServices((request) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
        const managed = request.path.endsWith("/question") || request.path.endsWith("/assess");
        if (
          managed &&
          (!expectedOwner ||
            (await Effect.runPromise(readNativeAiFunding(expectedOwner))) !== "managed")
        )
          return {
            status: 403,
            body: { error: "Choose Recall managed AI in Account for AI assessment." },
          };
        if (!token)
          return {
            status: 401,
            body: { error: "Sign in to synchronize activities or use hosted assessment." },
          };
        const fundingHeaders = managed
          ? { "x-recall-ai-funding": "managed", "x-recall-ai-request-id": Crypto.randomUUID() }
          : {};
        return withNativeRequest(
          `${baseUrl.replace(/\/$/, "")}${request.path}`,
          {
            method: request.method,
            headers: {
              ...fundingHeaders,
              authorization: `Bearer ${token}`,
              ...(expectedOwner ? { "x-recall-owner": expectedOwner } : {}),
              ...(request.body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          },
          async (response) => ({
            status: response.status,
            body: (await response.json()) as unknown,
          }),
        );
      },
      catch: (): ActivityFailure => ({
        _tag: "ActivityFailure",
        reason: "assessment-unavailable",
        message: "Learning services could not be reached. Your work is retained on this device.",
      }),
    }),
  );
}
