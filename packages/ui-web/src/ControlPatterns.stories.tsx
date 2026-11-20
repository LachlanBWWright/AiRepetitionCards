import type { Meta, StoryObj } from "@storybook/react";
import { Plus, MoreHorizontal } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./components/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./components/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./components/collapsible";
import { FormActions } from "./components/form-actions";

function ControlPatterns() {
  return (
    <main className="mx-auto grid max-w-3xl gap-8 p-6 text-foreground">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">Actions and details</h1>
        <p className="text-sm text-muted-foreground">Shared controls used throughout Recall.</p>
      </header>
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Everyday actions</h2>
        <div className="flex flex-wrap gap-3">
          <Button>
            <Plus />
            Add card
          </Button>
          <Button variant="secondary">Import cards</Button>
          <a
            className="text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            href="#forms-and-dialogs"
          >
            Jump to form controls
          </a>
          <Button variant="secondary">Preview</Button>
          <Button variant="destructive">Delete card</Button>
          <Button variant="secondary" size="icon" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled>Saving changes…</Button>
          <Button variant="secondary" disabled>
            Restore backup
          </Button>
        </div>
      </section>
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Compact toolbar</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary">
            Edit
          </Button>
          <Button size="sm" variant="secondary">
            Preview
          </Button>
          <Button size="icon-sm" variant="secondary" aria-label="Card actions">
            <MoreHorizontal />
          </Button>
        </div>
      </section>
      <section className="grid gap-4">
        <h2 id="forms-and-dialogs" className="text-lg font-semibold">
          Forms and dialogs
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input aria-label="Deck name" placeholder="Deck name" />
          <Select defaultValue="all">
            <SelectTrigger aria-label="Subject">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FormActions>
          <Button variant="secondary">Cancel</Button>
          <Button>Save changes</Button>
        </FormActions>
      </section>
      <section className="divide-y rounded-lg border px-2">
        <Collapsible>
          <CollapsibleTrigger>Memory and study details</CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-4 text-sm text-muted-foreground">
            12 successful recalls from 15 first daily attempts.
          </CollapsibleContent>
        </Collapsible>
        <Collapsible defaultOpen>
          <CollapsibleTrigger>
            A longer section title that should wrap cleanly on a narrow screen
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-4 text-sm text-muted-foreground">
            The chevron remains aligned while the title wraps.
          </CollapsibleContent>
        </Collapsible>
        <Collapsible>
          <CollapsibleTrigger disabled>Unavailable while saving</CollapsibleTrigger>
          <CollapsibleContent>This content is disabled.</CollapsibleContent>
        </Collapsible>
      </section>
    </main>
  );
}
const meta = {
  title: "Design System/Control patterns",
  component: ControlPatterns,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ControlPatterns>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConsistentControls: Story = {};
