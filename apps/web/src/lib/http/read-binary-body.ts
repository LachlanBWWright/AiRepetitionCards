import { Effect } from "effect";

export type BinaryBodyError = {
  readonly _tag: "BinaryBodyError";
  readonly reason: "too-large" | "unsupported-media-type" | "unreadable";
};

/** Read a binary request body with a hard byte limit and a typed transport failure. */
export function readBinaryBody(
  request: Request,
  maximumBytes: number,
): Effect.Effect<Uint8Array, BinaryBodyError> {
  const contentType = request.headers.get("content-type");
  if (
    contentType === null ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/octet-stream"
  ) {
    return Effect.fail({ _tag: "BinaryBodyError", reason: "unsupported-media-type" });
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
    catch: (): BinaryBodyError => ({ _tag: "BinaryBodyError", reason: "unreadable" }),
  });

  return Effect.flatMap(bytes, (value) =>
    value === null
      ? Effect.fail({ _tag: "BinaryBodyError", reason: "too-large" } as const)
      : Effect.succeed(value),
  );
}
