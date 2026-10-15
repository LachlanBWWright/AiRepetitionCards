import { Effect } from "effect";
import { createActivityServices, type ActivityFailure } from "@recall/application";
import { withNativeRequest } from "./native-http";
export function createNativeActivityServices(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
  expectedOwner?: string,
) {
  return createActivityServices((request) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
        if (!token)
          return {
            status: 401,
            body: { error: "Sign in to synchronize activities or use hosted assessment." },
          };
        return withNativeRequest(
          `${baseUrl.replace(/\/$/, "")}${request.path}`,
          {
            method: request.method,
            headers: {
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
