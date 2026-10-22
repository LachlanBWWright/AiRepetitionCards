import { Schema } from "effect";

const CoordinateSchema = Schema.Number.pipe(Schema.finite(), Schema.between(0, 1));
export const OcclusionPointSchema = Schema.Struct({ x: CoordinateSchema, y: CoordinateSchema });
export const OcclusionMaskSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  label: Schema.String.pipe(Schema.maxLength(200)),
  groupId: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100))),
  shape: Schema.Literal("rectangle", "ellipse", "polygon"),
  points: Schema.Array(OcclusionPointSchema).pipe(Schema.minItems(2), Schema.maxItems(32)),
}).pipe(
  Schema.filter((mask) => {
    if (mask.shape !== "polygon")
      return (
        mask.points.length === 2 &&
        mask.points[0]?.x !== mask.points[1]?.x &&
        mask.points[0]?.y !== mask.points[1]?.y
      );
    if (mask.points.length < 3) return false;
    const area = mask.points.reduce((sum, point, index) => {
      const next = mask.points[(index + 1) % mask.points.length];
      return sum + (next ? point.x * next.y - next.x * point.y : 0);
    }, 0);
    return Math.abs(area) > 0.00001;
  }),
);
export const ImageOcclusionSchema = Schema.Struct({
  imageMediaId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  sourceId: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100))),
  masks: Schema.Array(OcclusionMaskSchema).pipe(Schema.minItems(1), Schema.maxItems(100)),
  targetMaskIds: Schema.Array(Schema.String).pipe(Schema.minItems(1), Schema.maxItems(100)),
  mode: Schema.Literal("hide-one", "hide-all"),
}).pipe(
  Schema.filter((image) => {
    const ids = new Set(image.masks.map((mask) => mask.id));
    return (
      ids.size === image.masks.length &&
      new Set(image.targetMaskIds).size === image.targetMaskIds.length &&
      image.targetMaskIds.every((id) => ids.has(id))
    );
  }),
);
export type OcclusionPoint = typeof OcclusionPointSchema.Type;
export type OcclusionMask = typeof OcclusionMaskSchema.Type;
export type ImageOcclusion = typeof ImageOcclusionSchema.Type;

/** In-progress geometry may be degenerate; strict card validation happens at save. */
export const ImageOcclusionDraftSchema = Schema.Struct({
  imageMediaId: Schema.String.pipe(Schema.maxLength(100)),
  sourceId: Schema.optional(Schema.String.pipe(Schema.maxLength(100))),
  masks: Schema.Array(
    Schema.Struct({
      id: Schema.String.pipe(Schema.maxLength(100)),
      label: Schema.String.pipe(Schema.maxLength(200)),
      groupId: Schema.optional(Schema.String.pipe(Schema.maxLength(100))),
      shape: Schema.Literal("rectangle", "ellipse", "polygon"),
      points: Schema.Array(
        Schema.Struct({
          x: Schema.Number.pipe(Schema.finite()),
          y: Schema.Number.pipe(Schema.finite()),
        }),
      ).pipe(Schema.maxItems(32)),
    }),
  ).pipe(Schema.maxItems(100)),
  targetMaskIds: Schema.Array(Schema.String).pipe(Schema.maxItems(100)),
  mode: Schema.Literal("hide-one", "hide-all"),
});
