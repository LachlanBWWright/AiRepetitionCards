import { Effect } from "effect";
import { createTutorApi, type TutorHttpRequest } from "@recall/application";
import { withNativeRequest } from "./native-http";

/** Composes the shared tutor API with native bearer authentication and fetch. */
export function makeNativeTutorApi(apiUrl: string, getAccessToken: () => Promise<string | null>) {
  const baseUrl = apiUrl.trim().replace(/\/$/, "");
  return createTutorApi((request: TutorHttpRequest) =>
    Effect.tryPromise({
      try: async () => {
        const token = await getAccessToken();
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
    }),
  );
}
