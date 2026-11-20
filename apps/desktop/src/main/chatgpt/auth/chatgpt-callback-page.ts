import { createHash } from "node:crypto";
import type { ServerResponse } from "node:http";
import {
  chatGptCallbackPage,
  chatGptCallbackPages,
  chatGptCallbackScript,
  chatGptCallbackStyle,
  type CallbackState,
} from "@recall/infra-openai/chatgpt-callback-page";

export { chatGptCallbackPage };
const hash = (value: string) => createHash("sha256").update(value).digest("base64");
const pages = chatGptCallbackPages(hash(chatGptCallbackScript), hash(chatGptCallbackStyle));

export function sendChatGptCallbackPage(response: ServerResponse, state: CallbackState): void {
  response.writeHead(state === "invalid" ? 400 : 200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": pages.policy,
  });
  response.end(pages[state]);
}
