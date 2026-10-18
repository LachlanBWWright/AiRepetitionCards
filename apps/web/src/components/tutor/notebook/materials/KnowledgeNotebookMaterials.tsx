import { NotebookMaterialSetup } from "./NotebookMaterialSetup";
import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Button, Input } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { TabsContent } from "@recall/ui-web/components/tabs";
import { StudyMaterialsPanel } from "../../materials/StudyMaterialsPanel";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";

import { KnowledgeNotebookConceptList } from "../KnowledgeNotebookConcept";

function isSuggestedConceptDuplicate(
  title: string,
  notebook: NonNullable<KnowledgeNotebookModel["notebook"]>,
): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  return notebook.concepts.some(
    (concept) =>
      concept.parentId === notebook.session.targetConceptId &&
      concept.title.trim().toLowerCase() === normalizedTitle,
  );
}

function SuggestedConceptRow({
  title,
  description,
  notebook,
  disabled,
  onAdd,
}: {
  readonly title: string;
  readonly description: string;
  readonly notebook: NonNullable<KnowledgeNotebookModel["notebook"]>;
  readonly disabled: boolean;
  readonly onAdd: (title: string, description: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3">
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button
        variant="outline"
        size="small"
        disabled={disabled || isSuggestedConceptDuplicate(title, notebook)}
        onClick={() => {
          onAdd(title, description);
        }}
      >
        Add concept
      </Button>
    </div>
  );
}

function AddConceptForm({
  notebook,
  busy,
  unsaved,
  conceptTitle,
  setConceptTitle,
  parentId,
  setParentId,
  onAdd,
}: Pick<
  KnowledgeNotebookModel,
  "busy" | "unsaved" | "conceptTitle" | "setConceptTitle" | "parentId" | "setParentId"
> & {
  readonly notebook: NonNullable<KnowledgeNotebookModel["notebook"]>;
  readonly onAdd: KnowledgeNotebookModel["addConcept"];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <Label>
        Add a concept
        <Input
          value={conceptTitle}
          onChange={(event) => {
            setConceptTitle(event.target.value);
          }}
        />
      </Label>
      <Label>
        Within
        <Select
          value={parentId || "__recall_none__"}
          onValueChange={(value) => {
            setParentId(value === "__recall_none__" ? "" : value);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Within">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__recall_none__">Map root</SelectItem>
            {notebook.concepts.map((concept) => (
              <SelectItem key={concept.id} value={concept.id}>
                {concept.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Button
        type="button"
        variant="secondary"
        size="small"
        disabled={busy || unsaved || !conceptTitle.trim()}
        onClick={onAdd}
      >
        Add concept
      </Button>
    </div>
  );
}

function NotebookManagement({
  busy,
  unsaved,
  clearConfirm,
  onExport,
  onRetrySave,
  onClear,
  onConfirmClear,
  onCancelClear,
}: {
  readonly busy: boolean;
  readonly unsaved: boolean;
  readonly clearConfirm: boolean;
  readonly onExport: KnowledgeNotebookModel["exportNotebook"];
  readonly onRetrySave: () => void;
  readonly onClear: KnowledgeNotebookModel["clear"];
  readonly onConfirmClear: () => void;
  readonly onCancelClear: () => void;
}) {
  return (
    <section className="border-t pt-4">
      <h3 className="text-sm font-semibold leading-6">Manage notebook</h3>
      <div className="space-y-4 pt-3">
        <div className="flex flex-wrap gap-3 py-3">
          <Button type="button" variant="secondary" size="small" onClick={onExport}>
            Export notebook
          </Button>
          {unsaved && (
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={onRetrySave}
            >
              Retry saving notebook
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={onConfirmClear}
          >
            Clear notebook
          </Button>
        </div>
        {clearConfirm && (
          <Alert variant="destructive">
            <AlertDescription>
              Clear this notebook’s map, answers and proposals? Approved library cards and review
              history remain. Export the notebook first if you want to keep it.
            </AlertDescription>
            <Button type="button" disabled={busy} onClick={onClear}>
              Confirm clear notebook
            </Button>
            <Button type="button" disabled={busy} onClick={onCancelClear}>
              Cancel
            </Button>
          </Alert>
        )}
      </div>
    </section>
  );
}

function NotebookConceptArea({
  notebook,
  assessments,
  libraryCards,
  busy,
  unsaved,
  conceptTitle,
  setConceptTitle,
  parentId,
  setParentId,
  onAdd,
}: {
  readonly notebook: NonNullable<KnowledgeNotebookModel["notebook"]>;
  readonly assessments: KnowledgeNotebookModel["assessments"];
  readonly libraryCards: KnowledgeNotebookModel["knowledgeArea"]["cards"];
  readonly busy: boolean;
  readonly unsaved: boolean;
  readonly conceptTitle: string;
  readonly setConceptTitle: KnowledgeNotebookModel["setConceptTitle"];
  readonly parentId: string;
  readonly setParentId: KnowledgeNotebookModel["setParentId"];
  readonly onAdd: KnowledgeNotebookModel["addConcept"];
}) {
  return (
    <div className="space-y-4 pt-3">
      <ul className="list-none p-0">
        <KnowledgeNotebookConceptList
          concepts={notebook.concepts}
          notebook={notebook}
          assessments={assessments}
          libraryCards={libraryCards}
        />
      </ul>
      <AddConceptForm
        notebook={notebook}
        busy={busy}
        unsaved={unsaved}
        conceptTitle={conceptTitle}
        setConceptTitle={setConceptTitle}
        parentId={parentId}
        setParentId={setParentId}
        onAdd={onAdd}
      />
    </div>
  );
}

export function KnowledgeNotebookMaterials({ model }: { readonly model: KnowledgeNotebookModel }) {
  const {
    notebook,
    knowledgeArea,
    api,
    busy,
    unsaved,
    networkDisabled,
    save,
    run,
    clock,
    research,
    pendingQuestion,
    acceptSuggestedConcept,
    assessments,
    conceptTitle,
    setConceptTitle,
    parentId,
    setParentId,
    addConcept,
    exportNotebook,
    current,
    setClearConfirm,
    clearConfirm,
    clear,
  } = model;
  const retrySave = () => {
    if (current.current) run(save(current.current));
  };
  const cancelClear = () => {
    setClearConfirm(false);
  };
  return (
    <TabsContent value="materials" forceMount className="space-y-8 data-[state=inactive]:hidden">
      {notebook ? (
        <StudyMaterialsPanel
          notebook={notebook}
          knowledgeArea={knowledgeArea}
          api={api}
          disabled={busy || unsaved}
          networkDisabled={networkDisabled || notebook.session.phase === "idle"}
          save={save}
          run={run}
          clock={clock}
        />
      ) : (
        <NotebookMaterialSetup model={model} />
      )}
      {research && <div className="border-t pt-6">{research}</div>}
      {notebook && (
        <>
          <section className="my-6 list-none p-0">
            <h3 className="text-sm font-semibold leading-6">
              Concepts ({notebook.concepts.length})
            </h3>
            {pendingQuestion?.conceptSuggestions?.map((suggestion) => (
              <SuggestedConceptRow
                key={suggestion.title}
                title={suggestion.title}
                description={suggestion.description}
                notebook={notebook}
                disabled={busy || unsaved}
                onAdd={acceptSuggestedConcept}
              />
            ))}

            <NotebookConceptArea
              notebook={notebook}
              assessments={assessments}
              libraryCards={knowledgeArea.cards}
              busy={busy}
              unsaved={unsaved}
              conceptTitle={conceptTitle}
              setConceptTitle={setConceptTitle}
              parentId={parentId}
              setParentId={setParentId}
              onAdd={addConcept}
            />
          </section>{" "}
          <NotebookManagement
            busy={busy}
            unsaved={unsaved}
            clearConfirm={clearConfirm}
            onExport={exportNotebook}
            onRetrySave={retrySave}
            onClear={clear}
            onConfirmClear={() => {
              setClearConfirm(true);
            }}
            onCancelClear={cancelClear}
          />
        </>
      )}
    </TabsContent>
  );
}
