export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item: unknown) => stable(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}
