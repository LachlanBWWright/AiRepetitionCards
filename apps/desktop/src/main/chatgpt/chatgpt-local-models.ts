import { Either, Schema } from "effect";
import {
  resource,
  Models,
  fail,
  jsonResponse,
  responseFailure,
  type Reply,
} from "./transport/chatgpt-local-protocol";

export async function readChatGPTModels(
  accessToken: string,
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<Reply<readonly { readonly slug: string; readonly displayName: string }[]>> {
  const response = await request(`${resource}/models`, {
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const raw = await jsonResponse(response);
  if (!response.ok) return responseFailure(raw, response);
  const decoded = Schema.decodeUnknownEither(Models)(raw);
  if (Either.isLeft(decoded)) return fail("invalid-model-catalog");
  return {
    _tag: "Success",
    value: decoded.right.models
      .filter((model) => model.visibility === "list")
      .map((model) => ({ slug: model.slug, displayName: model.display_name })),
  };
}
