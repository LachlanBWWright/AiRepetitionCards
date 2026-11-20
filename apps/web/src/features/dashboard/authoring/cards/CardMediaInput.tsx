import { useState } from "react";
import { Label } from "@recall/ui-web/components/label";
import { Input } from "@recall/ui-web/components/input";
import { MediaAttachmentEditor } from "../notes/media/MediaAttachmentEditor";

export function CardMediaInput({
  file,
  onAttach,
}: {
  readonly file: File | null;
  readonly onAttach: (file: File) => void;
}) {
  const [pending, setPending] = useState<File | null>(null);
  return (
    <>
      <Label htmlFor="card-media">Attach image or audio (20 MB max)</Label>
      <Input
        id="card-media"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/webm"
        onChange={(event) => {
          setPending(event.currentTarget.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
      {pending && (
        <MediaAttachmentEditor
          key={`${pending.name}-${String(pending.lastModified)}`}
          file={pending}
          onCancel={() => {
            setPending(null);
          }}
          onAttach={(edited) => {
            onAttach(edited);
            setPending(null);
          }}
        />
      )}
      {file && (
        <p className="text-sm text-muted-foreground">
          {file.name} · {Math.ceil(file.size / 1024)} KB ready to attach
        </p>
      )}
    </>
  );
}
