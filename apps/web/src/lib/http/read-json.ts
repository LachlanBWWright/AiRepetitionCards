import { Effect } from "effect";

export type JsonBodyError = {
  readonly _tag: "JsonBodyError";
  readonly reason: "too-large" | "invalid-json" | "unreadable";
};

export function readJsonBody(
  request: Request,
  maximumBytes: number,
): Effect.Effect<unknown, JsonBodyError> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      return Effect.fail({ _tag: "JsonBodyError", reason: "too-large" });
    }
  }

  const bytes = Effect.tryPromise({
    try: async (): Promise<Uint8Array | null> => {
      const reader = request.body?.getReader();
      if (!reader) return new Uint8Array();
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        byteLength += chunk.value.byteLength;
        if (byteLength > maximumBytes) {
          void reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(chunk.value);
      }
      const result = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    },
    catch: (): JsonBodyError => ({ _tag: "JsonBodyError", reason: "unreadable" }),
  });

  return Effect.flatMap(bytes, (value) => {
    if (value === null) return Effect.fail({ _tag: "JsonBodyError", reason: "too-large" });
    return Effect.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)) as unknown,
      catch: (): JsonBodyError => ({ _tag: "JsonBodyError", reason: "invalid-json" }),
    });
  });
}
