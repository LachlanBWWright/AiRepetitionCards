import { anthropicOutputSchema } from "./anthropic-schema";
import { Schema, Either } from "effect";

export type StructuredProtocol = "openai" | "anthropic";
export function prepareStructuredRequest(
  protocol: StructuredProtocol,
  apiKey: string,
  input: {
    readonly model: string;
    readonly operation: string;
    readonly maximumOutputTokens: number;
    readonly instructions: string;
    readonly input: string;
    readonly schema: unknown;
  },
) {
  return protocol === "anthropic"
    ? {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: input.maximumOutputTokens,
          system: input.instructions,
          messages: [{ role: "user", content: input.input }],
          output_config: {
            format: { type: "json_schema", schema: anthropicOutputSchema(input.schema) },
          },
        }),
      }
    : {
        url: "https://api.openai.com/v1/responses",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          store: false,
          max_output_tokens: input.maximumOutputTokens,
          instructions: input.instructions,
          input: input.input,
          text: {
            format: {
              type: "json_schema",
              name: input.operation.replaceAll("-", "_"),
              strict: true,
              schema: input.schema,
            },
          },
        }),
      };
}
const Count = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const AnthropicReply = Schema.Struct({
  model: Schema.optional(Schema.String),
  stop_reason: Schema.optional(Schema.String),
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  ),
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Count),
      output_tokens: Schema.optional(Count),
      cache_creation_input_tokens: Schema.optional(Count),
      cache_read_input_tokens: Schema.optional(Count),
    }),
  ),
});
/** Normalize the Messages protocol to the existing internal structured-response reader. */
export function normalizeStructuredReply(protocol: StructuredProtocol, raw: unknown): unknown {
  if (protocol === "openai") return raw;
  const decoded = Schema.decodeUnknownEither(AnthropicReply)(raw);
  if (Either.isLeft(decoded)) return { status: "invalid" };
  const reply = decoded.right;
  const inputTokens = reply.usage?.input_tokens;
  const text = (reply.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
  const content =
    reply.stop_reason === "refusal" ? [{ type: "refusal" }] : [{ type: "output_text", text }];
  return {
    model: reply.model,
    status: reply.stop_reason === "end_turn" ? "completed" : "incomplete",
    usage: {
      input_tokens:
        inputTokens === undefined
          ? null
          : inputTokens +
            (reply.usage?.cache_creation_input_tokens ?? 0) +
            (reply.usage?.cache_read_input_tokens ?? 0),
      output_tokens: reply.usage?.output_tokens ?? null,
    },
    output: [
      {
        content,
      },
    ],
  };
}
