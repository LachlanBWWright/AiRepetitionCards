/** Electron file URLs need a relative packaged asset; Next serves the same WASM from public. */
export function ankiSqliteAssetPath(file: string): string {
  if (!file.endsWith(".wasm")) return file;
  if (typeof window !== "undefined" && window.location.protocol === "file:")
    return new URL("./vendor/sql-wasm.wasm", window.location.href).href;
  const base =
    typeof process === "undefined" ? "/" : (process.env.NEXT_PUBLIC_RECALL_ASSET_BASE ?? "/");
  return `${base}vendor/sql-wasm.wasm`;
}
