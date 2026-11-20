import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
import { Field, FieldLabel, FieldDescription, FieldError } from "@recall/ui-web/components/field";
import { Input } from "@recall/ui-web/components/input";
import { Button } from "@/components/ui/Button";
import { InlineImage } from "@/components/ui/InlineImage";
import type { ImageEditSchema, AudioEditSchema } from "./browser-media-edit";
import { useMediaEdit } from "./use-media-edit";

type Props = {
  readonly file: File;
  readonly onAttach: (file: File) => void;
  readonly onCancel: () => void;
};
export function MediaAttachmentEditor({ file, onAttach, onCancel }: Props) {
  const model = useMediaEdit(file, onAttach);
  const isImage = file.type.startsWith("image/");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.busy) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isImage ? "Crop and resize image" : "Trim audio"}</DialogTitle>
          <DialogDescription>
            Your original file is unchanged. Attach the original, or approve an edited copy below.
            Save the card or note to keep the attachment.
          </DialogDescription>
        </DialogHeader>
        {!model.canEdit ? (
          <FieldDescription>{model.previewMessage}</FieldDescription>
        ) : isImage ? (
          <ImageCropControls
            url={model.url}
            image={model.image}
            onChange={model.setImage}
            disabled={model.busy}
          />
        ) : (
          <AudioTrimControls
            url={model.url}
            audio={model.audio}
            onChange={model.setAudio}
            disabled={model.busy}
            duration={model.duration}
            onLoaded={model.loadedAudio}
          />
        )}
        {model.message && <FieldError>{model.message}</FieldError>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={model.busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={model.busy}
            onClick={() => {
              onAttach(file);
            }}
          >
            Attach original
          </Button>
          <Button type="button" disabled={model.busy || !model.canEdit} onClick={model.apply}>
            {model.busy ? "Processing…" : "Attach edited copy"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageCropControls({
  url,
  image,
  onChange,
  disabled,
}: {
  readonly url: string;
  readonly image: typeof ImageEditSchema.Type;
  readonly onChange: (value: typeof ImageEditSchema.Type) => void;
  readonly disabled: boolean;
}) {
  return (
    <>
      <div className="justify-self-start max-w-full overflow-hidden">
        <div className="relative inline-block">
          <InlineImage
            src={url}
            alt="Original attachment with crop outline"
            className="block max-h-48 max-w-full object-contain"
          />
          {Object.values(image).every(Number.isFinite) && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-primary bg-primary/10"
              style={{
                left: `${String(image.left)}%`,
                top: `${String(image.top)}%`,
                width: `${String(image.width)}%`,
                height: `${String(image.height)}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["left", "Left (%)"],
            ["top", "Top (%)"],
            ["width", "Crop width (%)"],
            ["height", "Crop height (%)"],
            ["maxWidth", "Maximum output width (px)"],
          ] satisfies readonly (readonly [keyof typeof image, string])[]
        ).map(([key, label]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`media-edit-${key}`}>{label}</FieldLabel>
            <Input
              id={`media-edit-${key}`}
              type="number"
              min={key === "maxWidth" ? 16 : 0}
              max={key === "maxWidth" ? 4096 : 100}
              value={Number.isFinite(image[key]) ? image[key] : ""}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...image, [key]: event.currentTarget.valueAsNumber });
              }}
            />
          </Field>
        ))}
      </div>
      <FieldDescription>
        The outline previews the crop. Coordinates are percentages of the original image. Output is
        a still PNG; animated images become a single frame.
      </FieldDescription>
    </>
  );
}

function AudioTrimControls({
  url,
  audio,
  onChange,
  disabled,
  duration,
  onLoaded,
}: {
  readonly url: string;
  readonly audio: typeof AudioEditSchema.Type;
  readonly onChange: (value: typeof AudioEditSchema.Type) => void;
  readonly disabled: boolean;
  readonly duration: number;
  readonly onLoaded: (duration: number) => void;
}) {
  return (
    <>
      <audio
        controls
        src={url}
        onLoadedMetadata={(event) => {
          onLoaded(event.currentTarget.duration);
        }}
      />
      <FieldDescription>
        Listen to the original, then choose a range in seconds. The edited copy uses portable WAV
        audio (up to 20 MB).
      </FieldDescription>
      <div className="grid grid-cols-2 gap-3">
        {(["start", "end"] satisfies readonly (keyof typeof audio)[]).map((key) => (
          <Field key={key}>
            <FieldLabel htmlFor={`media-edit-${key}`}>
              {key === "start" ? "Start (seconds)" : "End (seconds)"}
            </FieldLabel>
            <Input
              id={`media-edit-${key}`}
              type="number"
              min={0}
              max={duration || undefined}
              step="0.01"
              value={Number.isFinite(audio[key]) ? audio[key] : ""}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...audio, [key]: event.currentTarget.valueAsNumber });
              }}
            />
          </Field>
        ))}
      </div>
    </>
  );
}
