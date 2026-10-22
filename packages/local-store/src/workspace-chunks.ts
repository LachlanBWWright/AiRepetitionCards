const marker = "@recall/workspace-chunks:v1:";
const chunkCharacters = 65_536;
export function splitWorkspacePayload(serialized: string): readonly string[] {
  const chunks: string[] = [];
  for (let start = 0; start < serialized.length;) {
    let end = Math.min(start + chunkCharacters, serialized.length);
    const last = serialized.charCodeAt(end - 1);
    if (end < serialized.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(serialized.slice(start, end));
    start = end;
  }
  return chunks.length ? chunks : [""];
}
export const workspaceChunkManifest = (count: number): string => `${marker}${String(count)}`;
export function workspaceChunkCount(value: string): number | undefined {
  if (!value.startsWith(marker)) return undefined;
  const count = Number(value.slice(marker.length));
  return Number.isSafeInteger(count) && count > 0 && count <= 100_000 ? count : 0;
}
export function joinWorkspaceChunks(
  rows: readonly { readonly part: number; readonly payload: string }[],
  count: number,
): string | undefined {
  if (
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    rows.length !== count ||
    rows.some((row, index) => row.part !== index)
  )
    return undefined;
  return rows.map((row) => row.payload).join("");
}
