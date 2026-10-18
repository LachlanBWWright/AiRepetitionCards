import { ProposedCardPreview } from "../../proposals/ProposedCardPreview";
import { NotebookBatchApproval } from "./NotebookBatchApproval";
import { SavedSuggestionActions } from "./SavedSuggestionActions";
import { NotebookSuggestionSources } from "./NotebookSuggestionSources";
import type { ComponentProps } from "react";
import { Button } from "@recall/ui-web";
import { TabsContent } from "@recall/ui-web/components/tabs";
import { Effect, Either } from "effect";
import { applyNotebookRefinement } from "@recall/application";
import { ProposalDuplicateWarning } from "./ProposalDuplicateWarning";
import { CardAssistancePanel } from "../../assistance/CardAssistancePanel";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";
export function KnowledgeNotebookSuggestions({
  model,
  chat = false,
}: {
  readonly model: KnowledgeNotebookModel;
  readonly chat?: boolean;
}) {
  const {
    notebook,
    pendingProposals,
    networkDisabled,
    pendingQuestion,
    assessments,
    proposeGaps,
    drafts,
    proposalDuplicates,
    setActivity,
    busy,
    editProposal,
    knowledgeArea,
    duplicateCandidates,
    api,
    save,
    unsaved,
    working,
    setBusy,
    current,
    setMessage,
    setDrafts,
    setDuplicateAcknowledgements,
    resolve,
    accepted,
    onStartReview,
    additionalSuggestions,
    practiceTopics,
    onPracticeTopic,
    quickQuestionsBusy,
  } = model;
  const hasReinforcementGaps = assessments.some(
    (entry) => entry.status === "uncertain" || entry.status === "needs-reinforcement",
  );
  function openSource(sectionId: string) {
    setActivity("materials");
    const source = document.getElementById(`study-source-${sectionId}`);
    if (source instanceof HTMLElement)
      window.requestAnimationFrame(() => {
        source.focus();
        source.scrollIntoView({ block: "start" });
      });
  }
  async function applyRefinement(
    entry: KnowledgeNotebookModel["pendingProposals"][number],
    result: Parameters<NonNullable<ComponentProps<typeof CardAssistancePanel>["onApply"]>>[0],
  ): Promise<boolean> {
    const latest = current.current;
    if (!latest) return false;
    const resultSaved = await Effect.runPromise(
      Effect.either(
        applyNotebookRefinement(
          latest,
          {
            proposalId: entry.id,
            baseline: entry.proposal,
            cards: result.cards,
            newProposalIds: result.cards.map(() => crypto.randomUUID()),
          },
          knowledgeArea.cards,
        ).pipe(Effect.flatMap(save)),
      ),
    );
    if (Either.isLeft(resultSaved)) {
      setMessage(resultSaved.left.message);
      return false;
    }
    setDrafts((previous) => {
      return Object.fromEntries(Object.entries(previous).filter(([id]) => id !== entry.id));
    });
    return true;
  }
  function assistanceSources(entry: KnowledgeNotebookModel["pendingProposals"][number]) {
    if (!notebook) return [];
    return (entry.sourceReferences ?? []).slice(0, 1).flatMap((reference) => {
      const material = notebook.materials?.find((item) => item.id === reference.materialId);
      const section = material?.sections.find((item) => item.id === reference.sectionId);
      return section
        ? [
            {
              materialId: reference.materialId,
              sectionId: reference.sectionId,
              text: section.text,
              pageNumber: section.pageNumber,
            },
          ]
        : [];
    });
  }
  function renderPracticeTopic(
    topic: NonNullable<KnowledgeNotebookModel["practiceTopics"]>[number],
  ) {
    if (!onPracticeTopic) return null;
    return (
      <div key={topic.objectiveId} className="flex items-center justify-between gap-4 py-3">
        <p className="text-sm font-medium">{topic.objectiveTitle}</p>
        <Button
          variant="outline"
          size="small"
          disabled={busy || quickQuestionsBusy}
          onClick={() => {
            setActivity("quick");
            onPracticeTopic(topic);
          }}
        >
          Practise
        </Button>
      </div>
    );
  }
  function renderSuggestion(entry: KnowledgeNotebookModel["pendingProposals"][number]) {
    if (!notebook) return null;
    const draft = drafts[entry.id] ?? entry.proposal;
    const duplicates = proposalDuplicates(entry, draft);
    return (
      <ProposedCardPreview
        key={entry.id}
        proposal={draft}
        objectives={knowledgeArea.objectives}
        disabled={busy || unsaved}
        acceptDisabled={
          busy || unsaved || (duplicates.matches.length > 0 && !duplicates.acknowledged)
        }
        onChange={(next) => editProposal(entry.id, next)}
        onAccept={() => resolve(entry, "accepted")}
        onDiscard={() => resolve(entry, "discarded")}
        editorTools={
          <CardAssistancePanel
            proposal={draft}
            duplicateCandidates={duplicateCandidates}
            knowledgeArea={knowledgeArea}
            api={api}
            notebook={notebook}
            saveNotebook={save}
            disabled={busy || unsaved}
            networkDisabled={networkDisabled}
            onBusyChange={(value) => {
              working.current = value;
              setBusy(value);
            }}
            sources={assistanceSources(entry)}
            onApply={(result) => applyRefinement(entry, result)}
          />
        }
      >
        <NotebookSuggestionSources
          references={entry.sourceReferences ?? []}
          materials={notebook.materials}
          onOpen={openSource}
        />
        <ProposalDuplicateWarning
          matches={duplicates.matches}
          acknowledged={duplicates.acknowledged}
          disabled={busy || unsaved}
          onChange={(value) => {
            setDuplicateAcknowledgements((previous) => ({
              ...previous,
              [entry.id]: value ? duplicates.key : "",
            }));
          }}
        />
      </ProposedCardPreview>
    );
  }
  return (
    <TabsContent value="suggestions" forceMount className="data-[state=inactive]:hidden">
      {notebook ? (
        <>
          <div className="space-y-4">
            {!chat && (
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Review suggestions</h3>
                <p className="text-sm text-muted-foreground">
                  Check suggested cards before adding them to your library.
                </p>
              </div>
            )}
            {pendingProposals.length === 0 && <p>No suggestions to review.</p>}
            {!chat && (
              <Button
                type="button"
                variant="secondary"
                size="small"
                disabled={
                  networkDisabled ||
                  notebook.session.phase === "idle" ||
                  pendingQuestion != null ||
                  !hasReinforcementGaps
                }
                onClick={proposeGaps}
              >
                Generate cards for gaps
              </Button>
            )}
            {!chat && <NotebookBatchApproval model={model} />}
            {pendingProposals.map(renderSuggestion)}
            {!chat && (
              <SavedSuggestionActions
                accepted={accepted}
                proposals={notebook.proposals}
                busy={busy}
                onResolve={resolve}
                onStartReview={onStartReview}
              />
            )}
          </div>
        </>
      ) : !additionalSuggestions && !practiceTopics?.length ? (
        <p className="py-6 text-sm text-muted-foreground">
          Suggestions will appear here as you practise or work through study materials.
        </p>
      ) : null}
      {practiceTopics && practiceTopics.length > 0 && onPracticeTopic && (
        <section className="space-y-3" aria-label="Suggested practice topics">
          <h3 className="text-base font-semibold">Topics to practise</h3>
          <div className="divide-y">{practiceTopics.map(renderPracticeTopic)}</div>
        </section>
      )}
      {additionalSuggestions}
    </TabsContent>
  );
}
