import { Either, Schema } from "effect";

const Envelope = Schema.parseJson(
  Schema.Struct({
    task: Schema.String,
    schema: Schema.Unknown,
    data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
);
const History = Schema.Array(
  Schema.Struct({
    role: Schema.Union(Schema.Literal("learner"), Schema.Literal("assistant")),
    content: Schema.String,
  }),
);
type Message = { readonly role: "user" | "assistant"; readonly content: string };

/** Preserve real message boundaries so the stable deck and earlier turns can be cached.
 * All subject content remains user data, never promoted to developer instructions. */
export function chatGPTTutorMessages(serialized: string): readonly Message[] {
  const envelope = Schema.decodeUnknownEither(Envelope)(serialized);
  if (Either.isLeft(envelope)) return [{ role: "user", content: serialized }];
  const { task, schema, data } = envelope.right;
  const history = Schema.decodeUnknownEither(History)(data.history);
  if (Either.isLeft(history) || history.right.length === 0)
    return [{ role: "user", content: serialized }];
  const knowledgeArea = data.knowledgeArea;
  const context = Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== "knowledgeArea" && key !== "history"),
  );
  return [
    { role: "user", content: JSON.stringify({ task, schema, knowledgeArea }) },
    { role: "user", content: JSON.stringify({ context }) },
    ...history.right.map((message): Message => ({
      role: message.role === "learner" ? "user" : "assistant",
      content: message.content,
    })),
  ];
}
