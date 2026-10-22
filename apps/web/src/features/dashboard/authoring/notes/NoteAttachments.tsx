import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import { useRef } from "react";
import { Paperclip, FileAudio, Image, X } from "lucide-react";
import type { NoteAuthoringModel } from "@recall/react";
import { Input } from "@recall/ui-web/components/input";
import { Button } from "@/components/ui/Button";
import { readNoteMediaFile } from "./note-media-file";

export function NoteAttachments({ model }: { readonly model: NoteAuthoringModel }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          type="button"
          variant="ghost"
          size="small"
          className="-ml-2 gap-2 text-muted-foreground"
          disabled={model.busy || (model.note.media?.length ?? 0) >= 20}
          onClick={() => {
            input.current?.click();
          }}
        >
          <Paperclip className="size-4" aria-hidden="true" /> Attach image or audio
        </Button>
        <ExistingImages model={model} />
        <span className="text-xs text-muted-foreground">Up to 20 MB per file</span>
      </div>
      <Input
        ref={input}
        className="hidden"
        type="file"
        aria-label="Attach image or audio"
        tabIndex={-1}
        accept="image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/webm"
        disabled={model.busy || (model.note.media?.length ?? 0) >= 20}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) model.addAttachment(readNoteMediaFile(file));
          event.currentTarget.value = "";
        }}
      />
      {(model.note.media ?? []).map((media, index) => {
        const Icon = media.mimeType.startsWith("image/") ? Image : FileAudio;
        return (
          <div
            key={media.id}
            className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/30 px-3 py-2 text-sm"
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {media.mimeType.startsWith("image/") ? "Image" : "Audio"} {index + 1}
              <span className="ml-2 text-xs text-muted-foreground">
                {Math.ceil(media.byteLength / 1024)} KB
              </span>
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label={`Remove attachment ${String(index + 1)}`}
              disabled={model.busy}
              onClick={() => {
                model.removeAttachment(media.id);
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function ExistingImages({ model }: { readonly model: NoteAuthoringModel }) {
  if (!model.availableImages.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="small" disabled={model.busy}>
          Reuse an image
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {model.availableImages.map((image, index) => (
          <DropdownMenuItem
            key={image.id}
            onSelect={() => {
              model.insertImage(image.id);
            }}
          >
            Insert subject image {index + 1}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
