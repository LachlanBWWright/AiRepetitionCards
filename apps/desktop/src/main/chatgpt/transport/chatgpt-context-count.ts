import { Effect } from "effect";
import { enforceChatGPTContextLimit } from "./chatgpt-inference";

export function countLocalChatGPTContext(
  body: Readonly<Record<string, unknown>>,
  dependencies: {
    readonly request: typeof fetch;
    readonly resource: string;
    readonly accessToken: string;
    readonly signal: AbortSignal;
  },
) {
  const countBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "store" && key !== "stream"),
  );
  return Effect.runPromise(
    Effect.either(
      enforceChatGPTContextLimit(() =>
        dependencies.request(`${dependencies.resource}/responses/input_tokens`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([dependencies.signal, AbortSignal.timeout(30_000)]),
          headers: {
            authorization: `Bearer ${dependencies.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(countBody),
        }),
      ),
    ),
  );
}
