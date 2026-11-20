import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { Effect, Either } from "effect";
import { Input } from "@recall/ui-web/components/input";
import { MediaAttachmentEditor } from "@/features/dashboard/authoring/notes/media/MediaAttachmentEditor";
import { readNoteMediaFile } from "@/features/dashboard/authoring/notes/note-media-file";

function MediaEditingStory() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");
  function attach(edited: File) {
    void Effect.runPromise(Effect.either(readNoteMediaFile(edited))).then(async (asset) => {
      if (Either.isLeft(asset)) {
        setResult(asset.left.message);
        return;
      }
      const reference = asset.right.reference;
      if (reference.mimeType.startsWith("image/")) {
        const bitmap = await createImageBitmap(edited);
        setResult(JSON.stringify({ ...reference, width: bitmap.width, height: bitmap.height }));
        bitmap.close();
      } else {
        const bytes = await edited.arrayBuffer();
        const view = new DataView(bytes);
        setResult(
          JSON.stringify({
            ...reference,
            duration: view.getUint32(40, true) / view.getUint32(28, true),
          }),
        );
      }
      setFile(null);
    });
  }
  return (
    <div className="p-6">
      <Input
        type="file"
        aria-label="Choose media"
        onChange={(event) => {
          setResult("");
          setFile(event.currentTarget.files?.[0] ?? null);
        }}
      />
      {file && (
        <MediaAttachmentEditor
          file={file}
          onAttach={attach}
          onCancel={() => {
            setFile(null);
          }}
        />
      )}
      <output aria-label="Edited attachment">{result}</output>
    </div>
  );
}
const meta = { title: "Authoring/Media editing", component: MediaEditingStory } satisfies Meta<
  typeof MediaEditingStory
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
