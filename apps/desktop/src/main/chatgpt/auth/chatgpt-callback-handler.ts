import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, Either } from "effect";
import { sameSecret } from "../transport/chatgpt-local-protocol";
import { sendChatGptCallbackPage } from "./chatgpt-callback-page";

export function createChatGptCallbackHandler(
  state: string,
  receive: (url: URL) => void,
): (request: IncomingMessage, response: ServerResponse) => void {
  let received = false;
  return (request, response) => {
    const parsed = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => new URL(request.url ?? "", "http://127.0.0.1"),
          catch: () => null,
        }),
      ),
    );
    if (
      received ||
      Either.isLeft(parsed) ||
      request.method !== "GET" ||
      parsed.right.pathname !== "/auth/callback" ||
      parsed.right.searchParams.getAll("state").length !== 1 ||
      !sameSecret(parsed.right.searchParams.get("state") ?? "", state)
    ) {
      sendChatGptCallbackPage(response, "invalid");
      return;
    }
    received = true;
    const error = parsed.right.searchParams.get("error");
    sendChatGptCallbackPage(
      response,
      error === "access_denied" ? "cancelled" : error ? "invalid" : "received",
    );
    receive(parsed.right);
  };
}
