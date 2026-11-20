import { useEffect, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Either, Effect } from "effect";
import { exportPortableDeckPackage, toKnowledgeArea } from "@recall/application";
import type { MediaStore } from "@recall/local-store";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { PortableDeckTransfer } from "./PortableDeckTransfer";

const mediaStore: MediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};

type PortableDeckTransferStoryProps = {
  readonly showImportPreview?: boolean;
};

function PortableDeckTransferStory({ showImportPreview = false }: PortableDeckTransferStoryProps) {
  const root = useRef<HTMLDivElement>(null);
  const area = mockWorkspace.areas[0];

  useEffect(() => {
    if (!showImportPreview || !area || !root.current) return;
    const fileInput = root.current.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) return;

    const knowledgeArea = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
    if (Either.isLeft(knowledgeArea)) return;

    void Effect.runPromise(
      Effect.either(exportPortableDeckPackage(knowledgeArea.right, mediaStore)),
    ).then((result) => {
      if (Either.isLeft(result)) return;
      const buffer = new ArrayBuffer(result.right.byteLength);
      new Uint8Array(buffer).set(result.right);
      const file = new File([buffer], "cell-biology.recall-deck.zip", {
        type: "application/zip",
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: transfer.files,
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, [area, showImportPreview]);

  if (!area) return null;
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
      <div ref={root} className="mx-auto w-full max-w-3xl">
        <PortableDeckTransfer
          area={area}
          workspace={mockWorkspace}
          mediaStore={mediaStore}
          onImport={() => Promise.resolve(true)}
        />
      </div>
    </main>
  );
}

const meta = {
  title: "Deck Transfer/Portable deck",
  component: PortableDeckTransferStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PortableDeckTransferStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const ValidatedImportPreview: Story = {
  args: { showImportPreview: true },
};
