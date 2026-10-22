import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { RichTextEditor } from "./RichTextEditor";
import { CardRichText } from "./CardRichText";

const meta = {
  title: "Authoring/Rich text",
  component: RichTextEditor,
  parameters: { layout: "centered" },
} satisfies Meta<typeof RichTextEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
function EditorExample() {
  const [value, setValue] = useState(
    "The derivative of x² is 2x.\nSelect a word, then choose Bold.",
  );
  return (
    <section className="w-[min(560px,calc(100vw-32px))] rounded-xl border bg-background p-4">
      <label htmlFor="rich-example" className="mb-2 block text-sm font-medium">
        Answer
      </label>
      <RichTextEditor id="rich-example" value={value} onChange={setValue} rows={4} />
    </section>
  );
}
export const SelectionFormatting: Story = {
  args: { value: "", onChange: () => undefined },
  render: () => <EditorExample />,
};
export const ScientificCard: Story = {
  args: { value: "", onChange: () => undefined },
  render: () => (
    <section className="w-[min(560px,calc(100vw-32px))] rounded-xl border bg-background p-6">
      <CardRichText
        appearance={{ font: "serif", size: "medium", align: "left", lineSpacing: "comfortable" }}
        text={
          "# Gaussian integral\n$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$\nA rotation matrix:\n\\[\\begin{pmatrix}\\cos\\theta&-\\sin\\theta\\\\\\sin\\theta&\\cos\\theta\\end{pmatrix}\\]"
        }
      />
    </section>
  ),
};
