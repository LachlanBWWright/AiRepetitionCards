import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Schema } from "effect";
import {
  KnowledgeNotebookSchema,
  seedKnowledgeNotebook,
  toKnowledgeArea,
  type WorkspaceSearchResult,
} from "@recall/application";
import { createObjectiveId } from "@recall/domain";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { WorkspaceSearchPanel } from "./WorkspaceSearchPanel";

const area = Effect.runSync(toKnowledgeArea(mockWorkspace.areas[0]!, true, true));
const seed = Effect.runSync(seedKnowledgeNotebook(area, "Understand cell membrane transport."));
const conceptId = createObjectiveId("membrane-transport");
const materialId = "00000000-0000-4000-8000-000000000010";
const sectionId = "00000000-0000-4000-8000-000000000011";
const evidenceId = "00000000-0000-4000-8000-000000000012";
const notebook = Schema.decodeUnknownSync(KnowledgeNotebookSchema)({
  ...seed,
  concepts: [
    ...seed.concepts,
    {
      id: conceptId,
      title: "Membrane transport",
      description: "Diffusion, osmosis and active transport across cell membranes.",
      parentId: seed.concepts[0]?.id ?? null,
      objectiveId: conceptId,
      prerequisiteIds: [],
    },
  ],
  materials: [
    {
      id: materialId,
      name: "Cell membrane lecture notes",
      format: "paste",
      importedAt: 1000,
      warnings: [],
      sections: [
        {
          id: sectionId,
          title: "Passive transport",
          pageNumber: null,
          selected: true,
          text: "The cell membrane is selectively permeable. Osmosis moves water across a membrane down its water potential gradient.",
        },
      ],
    },
  ],
  evidence: [
    {
      kind: "tutor",
      id: evidenceId,
      conceptId,
      question: "Does water require ATP to cross the cell membrane by osmosis?",
      answer: "No, osmosis is passive transport.",
      learnerConfidence: "confident",
      at: 2000,
      linkedCardIds: [],
      evaluation: {
        result: "mastered",
        confidence: 0.9,
        objectiveId: conceptId,
        suggestedAction: "none",
        feedback: "Correct: osmosis does not require ATP.",
        misconception: null,
      },
    },
  ],
  proposals: [
    {
      id: "00000000-0000-4000-8000-000000000013",
      conceptId,
      evidenceIds: [evidenceId],
      createdAt: 3000,
      status: "pending",
      cardId: null,
      proposal: {
        front: "Why is membrane osmosis a passive process?",
        back: "Water moves down its water potential gradient without ATP expenditure.",
        objectiveId: conceptId,
        rationale: "Connect membrane permeability to the energy requirement.",
      },
    },
  ],
});
const demoNotebooks = [{ namespace: "hosted", notebook }];
function SearchStory({ query }: { readonly query: string }) {
  const [selected, setSelected] = useState<WorkspaceSearchResult | null>(null);
  return (
    <main style={{ minHeight: "100vh", background: "#faf9f6", padding: "40px 24px" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <h1>Search</h1>
        <WorkspaceSearchPanel
          workspace={mockWorkspace}
          ownershipKey="storybook"
          initialQuery={query}
          demoNotebooks={demoNotebooks}
          onOpenResult={setSelected}
        />
        {selected && (
          <p role="status">
            Opened {selected.areaTitle} · {selected.title}
          </p>
        )}
      </div>
    </main>
  );
}
const meta = {
  title: "Workspace/Search",
  component: WorkspaceSearchPanel,
  parameters: { layout: "fullscreen" },
  args: { workspace: mockWorkspace, ownershipKey: "storybook", onOpenResult: () => undefined },
  render: () => <SearchStory query="membrane" />,
} satisfies Meta<typeof WorkspaceSearchPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AcrossEverything: Story = {};
export const EmptyQuery: Story = { render: () => <SearchStory query="" /> };
export const NoMatches: Story = { render: () => <SearchStory query="electromagnetic induction" /> };
