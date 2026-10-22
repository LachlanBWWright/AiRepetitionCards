import { NativeOcclusionMaskFields } from "./NativeOcclusionMaskFields";
import type { ImageOcclusion, MediaReference, OcclusionMask } from "@recall/domain";
import { defaultOcclusionMask } from "@recall/application";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";
import type { CardEditorField } from "../authoring/editor/NativeWorkspaceCardEditor";
import { NativeOcclusionDrawingSurface } from "./NativeOcclusionDrawingSurface";

export function NativeImageOcclusionEditor({
  value,
  media,
  field,
  disabled,
  createId,
  uri,
  onChange,
}: {
  readonly value: ImageOcclusion | undefined;
  readonly media: readonly MediaReference[];
  readonly field: CardEditorField;
  readonly disabled: boolean;
  readonly createId: () => string;
  readonly uri?: string;
  readonly onChange: (image: ImageOcclusion | undefined) => void;
}) {
  const images = media.filter((reference) => reference.mimeType.startsWith("image/"));
  function updateMask(mask: OcclusionMask) {
    if (value)
      onChange({ ...value, masks: value.masks.map((item) => (item.id === mask.id ? mask : item)) });
  }
  if (!images.length) return null;
  if (!value)
    return (
      <NativeButton
        label="Add image occlusion"
        tone="soft"
        disabled={disabled}
        onPress={() => {
          const image = images[0];
          if (!image) return;
          const mask = defaultOcclusionMask(createId(), "rectangle");
          onChange({
            imageMediaId: image.id,
            masks: [mask],
            targetMaskIds: [mask.id],
            mode: "hide-one",
          });
        }}
      />
    );
  return (
    <View className="gap-3 border border-recall-line p-3">
      <Text className="text-recall-ink font-bold">Image occlusion</Text>
      <Text className="text-recall-muted">
        Each mask creates a card. Match group names to ask masks together. Coordinates run from 0 to
        1 across the full image.
      </Text>
      {images.map((image, index) => (
        <NativeButton
          key={image.id}
          label={`${image.id === value.imageMediaId ? "Selected: " : "Use "}image ${String(index + 1)}`}
          tone="soft"
          disabled={disabled}
          onPress={() => {
            onChange({ ...value, imageMediaId: image.id });
          }}
        />
      ))}
      <NativeButton
        label={value.mode === "hide-one" ? "Hide one, guess one" : "Hide all, guess one"}
        tone="soft"
        disabled={disabled}
        onPress={() => {
          onChange({ ...value, mode: value.mode === "hide-one" ? "hide-all" : "hide-one" });
        }}
      />
      {uri && (
        <>
          <Text>
            Drag across the image to position the most recently added mask. Use coordinates to
            adjust any mask.
          </Text>
          <NativeOcclusionDrawingSurface
            value={value}
            uri={uri}
            disabled={disabled}
            onChange={onChange}
          />
        </>
      )}
      {value.masks.map((mask, index) => (
        <NativeOcclusionMaskFields
          key={mask.id}
          mask={mask}
          index={index}
          field={field}
          disabled={disabled}
          canRemove={value.masks.length > 1}
          onChange={updateMask}
          onRemove={() => {
            const masks = value.masks.filter((item) => item.id !== mask.id);
            onChange({ ...value, masks, targetMaskIds: [masks[0]?.id ?? ""] });
          }}
        />
      ))}
      {(["rectangle", "ellipse", "polygon"] as const).map((shape) => (
        <NativeButton
          key={shape}
          label={`Add ${shape}`}
          tone="soft"
          disabled={disabled || value.masks.length >= 100}
          onPress={() => {
            onChange({
              ...value,
              masks: [...value.masks, defaultOcclusionMask(createId(), shape)],
            });
          }}
        />
      ))}
      <NativeButton
        label="Remove image occlusion"
        tone="soft"
        disabled={disabled}
        onPress={() => {
          onChange(undefined);
        }}
      />
    </View>
  );
}
