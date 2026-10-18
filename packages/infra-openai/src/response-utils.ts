import { JSONSchema, Schema } from "effect";

export type JsonSchema = Record<string, unknown>;

export function tokenCount(body: unknown, key: "input_tokens" | "output_tokens"): number | null {
  const response = asRecord(body);
  const usage = asRecord(response?.usage);
  const count = usage?.[key];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function isProviderQuotaExhausted(body: unknown): boolean {
  const response = asRecord(body);
  const error = asRecord(response?.error);
  return error?.code === "insufficient_quota" || error?.type === "insufficient_quota";
}

export function outputText(body: unknown): string | null {
  const response = asRecord(body);
  const output = response?.output;
  if (!Array.isArray(output)) return null;
  const outputItems: readonly unknown[] = output;
  for (const item of outputItems) {
    const outputItem = asRecord(item);
    const content = outputItem?.content;
    if (!Array.isArray(content)) continue;
    const blocks: readonly unknown[] = content;
    for (const block of blocks) {
      const record = asRecord(block);
      if (record?.type === "output_text" && typeof record.text === "string") return record.text;
    }
  }
  return null;
}

export function isRefusal(body: unknown): boolean {
  const response = asRecord(body);
  const output = response?.output;
  if (!Array.isArray(output)) return false;
  const outputItems: readonly unknown[] = output;
  return outputItems.some((item) => {
    const outputItem = asRecord(item);
    const content = outputItem?.content;
    if (!Array.isArray(content)) return false;
    const blocks: readonly unknown[] = content;
    return blocks.some((block) => asRecord(block)?.type === "refusal");
  });
}

export function objectiveIdsIn(data: unknown): ReadonlySet<string> {
  if (typeof data !== "object" || data === null) return new Set();
  const context = "context" in data ? data.context : data;
  if (typeof context !== "object" || context === null || !("knowledgeArea" in context)) {
    return new Set();
  }
  const knowledgeArea = context.knowledgeArea;
  if (
    typeof knowledgeArea !== "object" ||
    knowledgeArea === null ||
    !("objectives" in knowledgeArea)
  ) {
    return new Set();
  }
  const objectives = knowledgeArea.objectives;
  if (!Array.isArray(objectives)) return new Set();
  return new Set(
    objectives.flatMap((objective: unknown) =>
      typeof objective === "object" &&
      objective !== null &&
      "id" in objective &&
      typeof objective.id === "string"
        ? [objective.id]
        : [],
    ),
  );
}

export function schemaFor<T>(schema: Schema.Schema<T>): JsonSchema {
  return removeSchemaMetadata(JSONSchema.make(schema)) as JsonSchema;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function removeSchemaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeSchemaMetadata);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$schema" && key !== "$id" && key !== "title")
      .map(([key, item]) => [key, removeSchemaMetadata(item)]),
  );
}
