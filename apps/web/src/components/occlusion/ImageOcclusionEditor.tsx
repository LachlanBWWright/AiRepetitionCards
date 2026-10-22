import type { ImageOcclusion, MediaReference, OcclusionMask } from "@recall/domain";
import { defaultOcclusionMask } from "@recall/application";
import { Button } from "@/components/ui/Button";
import { OcclusionMaskFields } from "./OcclusionMaskFields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { OcclusionDrawingSurface } from "./OcclusionDrawingSurface";

export function ImageOcclusionEditor({
  value,
  media,
  url,
  disabled,
  onChange,
}: {
  readonly value: ImageOcclusion | undefined;
  readonly media: readonly MediaReference[];
  readonly url?: string;
  readonly disabled: boolean;
  readonly onChange: (value: ImageOcclusion | undefined) => void;
}) {
  const images = media.filter((reference) => reference.mimeType.startsWith("image/"));
  function updateMask(next: OcclusionMask) {
    if (value)
      onChange({ ...value, masks: value.masks.map((mask) => (mask.id === next.id ? next : mask)) });
  }
  function addMask(shape: OcclusionMask["shape"]) {
    if (value)
      onChange({
        ...value,
        masks: [...value.masks, defaultOcclusionMask(crypto.randomUUID(), shape)],
      });
  }
  const addButtons = value
    ? (["rectangle", "ellipse", "polygon"] as const).map((shape) => (
        <Button
          key={shape}
          type="button"
          variant="secondary"
          disabled={value.masks.length >= 100}
          onClick={() => {
            addMask(shape);
          }}
        >
          Add {shape}
        </Button>
      ))
    : null;
  if (!images.length)
    return (
      <p className="text-sm text-muted-foreground">
        To create image occlusion, attach an image, save the card, then reopen it.
      </p>
    );
  return (
    <fieldset disabled={disabled} className="grid gap-3 rounded-md border p-3">
      <legend>Image occlusion</legend>
      {!value ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const image = images[0];
            if (!image) return;
            const mask = defaultOcclusionMask(crypto.randomUUID(), "rectangle");
            onChange({
              imageMediaId: image.id,
              masks: [mask],
              targetMaskIds: [mask.id],
              mode: "hide-one",
            });
          }}
        >
          Add image masks
        </Button>
      ) : (
        <>
          <p className="text-sm">
            Each mask creates a card. Give masks the same group name to ask them together.
            Coordinates run from 0 to 1 across the full image.
          </p>
          <Select
            value={value.imageMediaId}
            onValueChange={(imageMediaId) => {
              onChange({ ...value, imageMediaId });
            }}
          >
            <SelectTrigger aria-label="Occlusion image">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {images.map((image, index) => (
                <ImageOption key={image.id} image={image} index={index} />
              ))}
            </SelectContent>
          </Select>
          <Select
            value={value.mode}
            onValueChange={(mode) => {
              if (mode === "hide-one" || mode === "hide-all") onChange({ ...value, mode });
            }}
          >
            <SelectTrigger aria-label="Occlusion mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hide-one">Hide one, guess one</SelectItem>
              <SelectItem value="hide-all">Hide all, guess one</SelectItem>
            </SelectContent>
          </Select>
          {url && !disabled && (
            <>
              <p className="text-sm">
                Drag over the image to position the most recently added mask. Use coordinates below
                to adjust any mask.
              </p>
              <OcclusionDrawingSurface value={value} url={url} onChange={onChange} />
            </>
          )}
          {value.masks.map((mask, index) => (
            <OcclusionMaskFields
              key={mask.id}
              mask={mask}
              index={index}
              canRemove={value.masks.length > 1}
              onChange={updateMask}
              onRemove={() => {
                const masks = value.masks.filter((item) => item.id !== mask.id);
                onChange({ ...value, masks, targetMaskIds: [masks[0]?.id ?? ""] });
              }}
            />
          ))}
          <div className="flex flex-wrap gap-2">{addButtons}</div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onChange(undefined);
            }}
          >
            Remove image occlusion
          </Button>
        </>
      )}
    </fieldset>
  );
}

function ImageOption({ image, index }: { readonly image: MediaReference; readonly index: number }) {
  return <SelectItem value={image.id}>{`Image ${String(index + 1)}`}</SelectItem>;
}
