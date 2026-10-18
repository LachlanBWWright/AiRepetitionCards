import { discardLibraryDraft } from "@recall/application";
import { Button } from "@/components/ui/Button";
import type { RecallDashboardModel } from "../../state/useRecallDashboardController";
export function RecallDashboardResumeADraft({ model }: { readonly model: RecallDashboardModel }) {
  const { libraryNotes, resumeLibraryDraft, requestConfirmation } = model;
  return (
    <section aria-label="Saved drafts" className="grid gap-2 rounded-xl border p-4">
      <h2 className="font-semibold">Resume a draft</h2>
      <p className="text-sm text-muted-foreground">
        Drafts stay in this tab across navigation. Save them as cards before closing or refreshing
        the tab.
      </p>
      {libraryNotes.notes.drafts.map((draft) => (
        <div key={draft.key} className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              resumeLibraryDraft(draft);
            }}
          >
            {draft.kind === "area"
              ? `Deck: ${draft.title || "Untitled"}`
              : `Card: ${draft.front || draft.clozeText || "Untitled"}`}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              requestConfirmation("Discard this saved draft?", () => {
                libraryNotes.update((notes) => discardLibraryDraft(notes, draft.key));
              });
            }}
          >
            Discard
          </Button>
          <p className="max-w-full whitespace-pre-wrap text-sm">
            {draft.kind === "card"
              ? `${draft.front || draft.clozeText} — ${draft.back}`
              : draft.title}
          </p>
        </div>
      ))}
    </section>
  );
}
