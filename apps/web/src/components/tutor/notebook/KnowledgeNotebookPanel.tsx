"use client";
import { ImprovementChat } from "../chat/ImprovementChat";
import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Button } from "@recall/ui-web";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@recall/ui-web/components/tabs";
import type { KnowledgeNotebookPanelProps } from "./KnowledgeNotebookPanel.types";
import { useKnowledgeNotebookModel } from "./useKnowledgeNotebookModel";
import { KnowledgeNotebookPractice } from "./practice/KnowledgeNotebookPractice";
import { KnowledgeNotebookMaterials } from "./materials/KnowledgeNotebookMaterials";
import { KnowledgeNotebookSuggestions } from "./proposals/KnowledgeNotebookSuggestions";
export function KnowledgeNotebookPanel(props: KnowledgeNotebookPanelProps) {
  const model = useKnowledgeNotebookModel(props);
  const {
    searchRoot,
    activity,
    hasQuickQuestions,
    setActivity,
    showActivityNavigation,
    pendingProposals,
    message,
    quickQuestions,
    loaded,
    unsaved,
    demo,
    busy,
    reloadNotebook,
  } = model;
  if (props.experience === "chat" && !props.activityOverride)
    return (
      <ImprovementChat
        model={model}
        modelSelection={props.modelSelection}
        unavailableReason={props.aiUnavailableReason}
      />
    );
  const suggestionBadge =
    pendingProposals.length > 0 ? ` (${String(pendingProposals.length)})` : "";
  return (
    <section
      ref={searchRoot}
      className="space-y-6 [&_p]:max-w-prose [&_[data-slot=label]]:grid [&_[data-slot=label]]:items-start [&_[data-slot=label]]:gap-2 [&_[data-slot=label]]:leading-[1.4] [&_[data-slot=textarea]]:w-full [&_[data-slot=input]]:w-full"
      aria-label="Knowledge notebook"
    >
      <Tabs
        className="space-y-6"
        value={props.activityOverride ?? activity}
        onValueChange={(value) => {
          if (
            value === "practice" ||
            (value === "quick" && hasQuickQuestions) ||
            value === "materials" ||
            value === "suggestions"
          )
            setActivity(value);
        }}
      >
        <div
          className={
            showActivityNavigation && !props.activityOverride ? "overflow-x-auto" : "hidden"
          }
        >
          <TabsList
            className="h-auto w-full min-w-max justify-start gap-1 rounded-none border-b bg-transparent p-0 sm:gap-6"
            aria-label="Study activities"
          >
            {(
              [
                ["practice", "Practice"],
                ...(hasQuickQuestions ? [["quick", "Quick questions"] as const] : []),
                ["materials", "Materials"],
                ["suggestions", "Suggestions"],
              ] as const
            ).map(([value, label]) => (
              <TabsTrigger
                key={value}
                value={value}
                className="relative flex-none rounded-none border-0 border-b-2 border-transparent px-3 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {label}
                {value === "suggestions" ? suggestionBadge : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {message && (
          <Alert className="mt-2" variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {hasQuickQuestions && (
          <TabsContent value="quick" forceMount className="data-[state=inactive]:hidden">
            {quickQuestions}
          </TabsContent>
        )}
        <KnowledgeNotebookPractice model={model} />

        <KnowledgeNotebookMaterials model={model} />
        <KnowledgeNotebookSuggestions model={model} />
      </Tabs>

      {(!loaded || unsaved) && !demo && (
        <div>
          {unsaved && (
            <p>
              Export current work before reloading; reloading replaces changes that have not been
              saved.
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={reloadNotebook}
          >
            Retry loading saved notebook
          </Button>
        </div>
      )}
      {busy && (
        <Alert role="status">
          <AlertDescription>Saving or investigating…</AlertDescription>
        </Alert>
      )}
      {unsaved && (
        <Alert role="status">
          <AlertDescription>
            Notebook changes remain in this view until saved. Export them before leaving.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
