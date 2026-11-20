import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReviewPresentation } from "@recall/domain";
import { ReviewPresentationSettings } from "./ReviewPresentationSettings";

const initialPresentation: ReviewPresentation = {
  appearance: {
    font: "sans",
    size: "medium",
    align: "left",
    lineSpacing: "comfortable",
    direction: "auto",
    imageSize: "medium",
  },
  typedAnswer: { enabled: true, ignoreCase: true, ignoreAccents: false },
  speech: {
    front: { language: "en-US", rate: 1, autoplay: true },
    back: { language: "en-GB", rate: 0.9, autoplay: false },
  },
};

function PresentationExample() {
  const [presentation, setPresentation] = useState(initialPresentation);
  return (
    <main className="mx-auto flex w-[min(720px,calc(100vw-32px))] flex-col gap-6 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Review presentation settings</h1>
        <p className="text-sm text-muted-foreground">
          Edit appearance, typed answers, and speech for both card sides.
        </p>
      </header>
      <ReviewPresentationSettings value={presentation} onChange={setPresentation} />
    </main>
  );
}

const meta = {
  title: "Authoring/Review presentation settings",
  component: ReviewPresentationSettings,
  parameters: { layout: "fullscreen" },
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')?.click();
  },
} satisfies Meta<typeof ReviewPresentationSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  args: { value: initialPresentation, onChange: () => undefined },
  render: () => <PresentationExample />,
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const PhoneLongLabels: Story = {
  args: { value: initialPresentation, onChange: () => undefined },
  render: () => <PresentationExample />,
  globals: { viewport: { value: "recallMobile", isRotated: false } },
};
