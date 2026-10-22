import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Schema } from "effect";
import { MediaReferenceSchema, type ImageOcclusion } from "@recall/domain";
import { defaultOcclusionMask } from "@recall/application";
import { Button } from "@/components/ui/Button";
import { ImageOcclusionEditor } from "./ImageOcclusionEditor";
import { ImageOcclusionView } from "./ImageOcclusionView";

const reference = Schema.decodeUnknownSync(MediaReferenceSchema)({
  id: "a".repeat(64),
  mimeType: "image/png",
  byteLength: 100,
});
const image: ImageOcclusion = {
  imageMediaId: reference.id,
  masks: [
    { ...defaultOcclusionMask("region-a", "rectangle"), label: "Northern region" },
    {
      ...defaultOcclusionMask("region-b", "ellipse"),
      points: [
        { x: 0.6, y: 0.6 },
        { x: 0.9, y: 0.8 },
      ],
    },
  ],
  mode: "hide-all",
  targetMaskIds: ["region-a"],
};
function OcclusionStory({ sourceUrl = "/globe.svg" }: { readonly sourceUrl?: string }) {
  const [draft, setDraft] = useState<ImageOcclusion | undefined>(image);
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="mx-auto grid max-w-3xl gap-4 p-6">
      <ImageOcclusionEditor
        value={draft}
        onChange={setDraft}
        media={[reference]}
        url={sourceUrl}
        disabled={false}
      />
      {draft && (
        <>
          <h2>Review preview</h2>
          <ImageOcclusionView image={draft} url={sourceUrl} revealed={revealed} />
          <Button
            onClick={() => {
              setRevealed(!revealed);
            }}
          >
            {revealed ? "Hide answer" : "Show answer"}
          </Button>
        </>
      )}
    </div>
  );
}
const meta = {
  title: "Features/Image Occlusion",
  component: OcclusionStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof OcclusionStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EditorAndReview: Story = {};

export const WideImage: Story = { args: { sourceUrl: "/next.svg" } };
