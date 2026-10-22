import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect } from "effect";
import { createAreaId, type Workspace } from "@recall/domain";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import { NoteLibraryEditor } from "./NoteLibraryEditor";
import { NativeNoteLibraryEditor } from "../../../../../../mobile/src/components/authoring/notes/NativeNoteLibraryEditor";

const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  areas: [{ id: createAreaId("shared-notes"), title: "Shared notes", color: "#123456", cards: [] }],
};
function NoteLibraryStory({ native = false }: { readonly native?: boolean }) {
  const [workspace, setWorkspace] = useState(initial);
  const area = workspace.areas[0];
  if (!area) return null;
  const props = {
    workspace,
    area,
    createId: () => crypto.randomUUID(),
    save: (command: import("@recall/application").WorkspaceAuthoringCommand, baseline?: string) =>
      applyWorkspaceAuthoringCommand(
        workspace,
        command,
        new Date("2026-10-20T00:00:00Z"),
        baseline,
      ).pipe(
        Effect.mapError((error) => ({ message: error.message })),
        Effect.map((result) => {
          setWorkspace(result.workspace);
          return result.workspace;
        }),
      ),
  };
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      {native ? <NativeNoteLibraryEditor {...props} /> : <NoteLibraryEditor {...props} />}
    </main>
  );
}
const meta = {
  title: "Knowledge/Shared note authoring",
  component: NoteLibraryStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NoteLibraryStory>;
export default meta;
export const Web: StoryObj<typeof meta> = {};
export const Native: StoryObj<typeof meta> = { args: { native: true } };
