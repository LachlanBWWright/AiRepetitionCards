/** Send Claude's supported schema subset; application validation retains every original constraint. */
export function anthropicOutputSchema(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(anthropicOutputSchema);
  if (typeof input !== "object" || input === null) return input;
  const omitted = new Set([
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "pattern",
    "format",
  ]);
  const entries: readonly (readonly [string, unknown])[] = Object.entries(input);
  const constraints = entries.filter(([key]) => omitted.has(key));
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (omitted.has(key)) continue;
    if (
      ["properties", "$defs", "definitions"].includes(key) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    )
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, anthropicOutputSchema(schema)]),
      );
    else result[key] = anthropicOutputSchema(value);
  }
  if (constraints.length)
    result.description =
      `${typeof result.description === "string" ? result.description : ""} Constraints: ${JSON.stringify(Object.fromEntries(constraints))}`.trim();
  if (result.type === "object" || (Array.isArray(result.type) && result.type.includes("object")))
    result.additionalProperties = false;
  return result;
}
