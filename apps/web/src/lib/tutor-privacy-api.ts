import { Effect } from "effect";
import { createTutorPrivacyApi } from "@recall/application";
import { apiFetch } from "@/lib/desktop-api";

export const tutorPrivacyApi = createTutorPrivacyApi((request) =>
  Effect.tryPromise({
    try: async () => {
      const response = await apiFetch(request.path, {
        method: request.method,
        ...(request.body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(request.body),
            }),
      });
      const body: unknown = await response.json();
      return { status: response.status, body };
    },
    catch: () => ({ _tag: "TutorPrivacyFailure", reason: "transport" }) as const,
  }),
);
