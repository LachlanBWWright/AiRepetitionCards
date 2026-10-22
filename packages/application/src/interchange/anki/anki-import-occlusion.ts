import { Either, Schema } from "effect";
import { ImageOcclusionSchema, type ImageOcclusion, type OcclusionMask } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { sanitizeField } from "./anki-import-media";

/** Decode geometry, never the imported note type's reviewer scripts. Unsupported shapes fail closed. */
export function importAnkiOcclusion(
  fields: ReadonlyMap<string, string>,
  ordinal: number,
  media: ReadonlyMap<string, StoredMediaAsset>,
):
  | {
      readonly image: ImageOcclusion;
      readonly attachment: StoredMediaAsset;
      readonly front: string;
      readonly back: string;
    }
  | undefined {
  const raw = fields.get("occlusion");
  const image = sanitizeField(fields.get("image") ?? "", media);
  if (!raw || !image || image === "invalid-media" || image.references.length !== 1)
    return undefined;
  const ref = image.references[0];
  const attachment = [...media.values()].find((asset) => asset.reference.id === ref?.id);
  if (!attachment || !attachment.reference.mimeType.startsWith("image/")) return undefined;
  const entries = [...raw.matchAll(/\{\{c(\d+)::image-occlusion:(rect|ellipse):([^{}]+)\}\}/g)];
  if (
    entries.length === 0 ||
    entries.length > 100 ||
    raw.replace(/\{\{c(\d+)::image-occlusion:(rect|ellipse):([^{}]+)\}\}/g, "").includes("{{")
  )
    return undefined;
  const masks: OcclusionMask[] = [];
  const targets: string[] = [];
  const modes = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const properties = Object.fromEntries(
      (entry[3] ?? "").split(":").map((part) => {
        const [key, value] = part.split("=");
        return [key ?? "", value] as const;
      }),
    );
    if (
      Object.keys(properties).some(
        (key) => !["left", "top", "width", "height", "rx", "ry", "oi", "angle"].includes(key),
      )
    )
      return undefined;
    if (properties.angle && Number(properties.angle) !== 0) return undefined;
    if (Number(entry[1]) < 1) return undefined;
    const x = Number(properties.left),
      y = Number(properties.top);
    const width = entry[2] === "rect" ? Number(properties.width) : 2 * Number(properties.rx);
    const height = entry[2] === "rect" ? Number(properties.height) : 2 * Number(properties.ry);
    const id = `anki-mask:${String(index)}`;
    masks.push({
      id,
      label: "",
      groupId: `anki-group:${String(entry[1])}`,
      shape: entry[2] === "rect" ? "rectangle" : "ellipse",
      points: [
        { x, y },
        { x: x + width, y: y + height },
      ],
    });
    if (Number(entry[1]) === ordinal + 1) targets.push(id);
    modes.add(properties.oi === "1" ? "hide-all" : "hide-one");
  }
  if (modes.size !== 1) return undefined;
  const decoded = Schema.decodeUnknownEither(ImageOcclusionSchema)({
    imageMediaId: attachment.reference.id,
    masks,
    targetMaskIds: targets,
    mode: [...modes][0],
  });
  if (Either.isLeft(decoded)) return undefined;
  const header = sanitizeField(fields.get("header") ?? "", media);
  const extra = sanitizeField(fields.get("back extra") ?? "", media);
  return {
    image: decoded.right,
    attachment,
    front: header && header !== "invalid-media" ? header.text : "Identify the hidden region",
    back: extra && extra !== "invalid-media" ? extra.text : "Reveal the hidden region",
  };
}
