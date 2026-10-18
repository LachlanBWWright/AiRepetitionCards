import type { MediaReference } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";

const MAX_FIELD_CHARS = 500_000;

export function mimeFor(name: string, bytes: Uint8Array): MediaReference["mimeType"] | undefined {
  const lower = name.toLowerCase();
  if (
    lower.endsWith(".png") &&
    bytes.length >= 8 &&
    bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
  )
    return "image/png";
  if (
    (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    lower.endsWith(".gif") &&
    (new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" ||
      new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")
  )
    return "image/gif";
  if (
    lower.endsWith(".webp") &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (
    lower.endsWith(".mp3") &&
    (new TextDecoder().decode(bytes.slice(0, 3)) === "ID3" ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0))
  )
    return "audio/mpeg";
  if (lower.endsWith(".ogg") && new TextDecoder().decode(bytes.slice(0, 4)) === "OggS")
    return "audio/ogg";
  if (
    lower.endsWith(".wav") &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE"
  )
    return "audio/wav";
  return undefined;
}

type SanitizedField = { readonly text: string; readonly references: readonly MediaReference[] };
export function sanitizeField(
  input: string,
  mediaByName: ReadonlyMap<string, StoredMediaAsset>,
): SanitizedField | "invalid-media" | undefined {
  if (input.length > MAX_FIELD_CHARS) return undefined;
  const references = new Map<string, MediaReference>();
  const invalidMedia = { value: false };
  let text = input
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*\/?>/gi, "");
  text = text.replace(/\[sound:([^\]\r\n]+)\]/gi, (_match, rawName: string) => {
    const asset = mediaByName.get(rawName.trim());
    if (!asset || !asset.reference.mimeType.startsWith("audio/")) {
      invalidMedia.value = true;
      return "[unsupported audio omitted]";
    }
    references.set(asset.reference.id, asset.reference);
    return `[Audio: ${rawName.replace(/[<>\[\]]/g, "")}]`;
  });
  text = text.replace(/<img\b([^>]*)>/gi, (_match, attrs: string) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const rawName = (src?.[1] ?? src?.[2] ?? src?.[3] ?? "").trim();
    const asset = mediaByName.get(rawName);
    if (!asset || !asset.reference.mimeType.startsWith("image/")) {
      invalidMedia.value = true;
      return "[unsupported image omitted]";
    }
    references.set(asset.reference.id, asset.reference);
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const label = (alt?.[1] ?? alt?.[2] ?? rawName).replace(/[<>\[\]]/g, "").slice(0, 200);
    return `[Image: ${label}]`;
  });
  // Retain a small formatting subset without any attributes. All links are reduced to their
  // visible text so javascript:, remote tracking URLs, and unsafe embedded content disappear.
  text = text
    .replace(/<\s*(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(div|p|li|h[1-6])\b[^>]*>/gi, "")
    .replace(/<\s*(b|strong|i|em|u|s|del|code|pre|sub|sup|ul|ol|blockquote)\b[^>]*>/gi, "<$1>")
    .replace(/<\s*\/\s*(b|strong|i|em|u|s|del|code|pre|sub|sup|ul|ol|blockquote)\s*>/gi, "</$1>")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, "$1")
    .replace(/<\s*[^>]*>/g, "")
    // Keep other entities encoded: decoding &lt;script&gt; here could recreate active markup
    // after tags had already been filtered.
    .replace(/&nbsp;/gi, " ")
    .trim();
  if (invalidMedia.value) return "invalid-media";
  return text ? { text, references: [...references.values()] } : undefined;
}
