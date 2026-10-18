import type { UnzipFileInfo } from "fflate";

const maxExpansionRatio = 200;
const ratioAllowanceBytes = 65_536;

/** Check ZIP directory sizes before any entry is inflated. */
export function hasSafeZipExpansion(
  entries: readonly UnzipFileInfo[],
  limits: { readonly maxFiles: number; readonly maxExpandedBytes: number },
): boolean {
  if (entries.length > limits.maxFiles) return false;
  let expandedBytes = 0;
  let compressedBytes = 0;
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.size) ||
      !Number.isSafeInteger(entry.originalSize) ||
      entry.size < 0 ||
      entry.originalSize < 0 ||
      entry.originalSize > Math.max(ratioAllowanceBytes, entry.size * maxExpansionRatio)
    ) {
      return false;
    }
    compressedBytes += entry.size;
    expandedBytes += entry.originalSize;
  }
  return (
    expandedBytes <= limits.maxExpandedBytes &&
    expandedBytes <= Math.max(ratioAllowanceBytes, compressedBytes * maxExpansionRatio)
  );
}
