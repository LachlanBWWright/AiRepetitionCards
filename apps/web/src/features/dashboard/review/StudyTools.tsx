import type { MediaTrashPurgeResult } from "@recall/application";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@recall/ui-web/components/tabs";
import { CardBrowser } from "./CardBrowser";
import { CollectionMaintenance } from "./CollectionMaintenance";
import { StudySyncConflict } from "./StudySyncConflict";
import { useState } from "react";
import type { WorkspaceStore, MediaStore } from "@recall/local-store";
import type { Assessment, LearningArea, Workspace, MediaReference } from "@recall/domain";
import { undoableReview } from "@recall/application";
import { studyCardStatus } from "@recall/application";
import { Button } from "@/components/ui/Button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@recall/ui-web/components/dialog";
import { useStudyCardControls, type SaveStudyCommand } from "./useStudyCardControls";
import { CramPractice } from "./CramPractice";
import { ManualScheduling } from "./ManualScheduling";

export function StudyTools({
  workspace,
  mediaStore,
  protectedReferences,
  workspaceStore,
  onPurged,
  area,
  card,
  save,
  onEdit,
  disabled,
}: {
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly workspace: Workspace;
  readonly mediaStore: MediaStore;
  readonly area: LearningArea;
  readonly card: Assessment | undefined;
  readonly save: SaveStudyCommand;
  readonly onEdit: (card: Assessment) => void;
  readonly disabled: boolean;
}) {
  const controls = useStudyCardControls(workspace, save);
  const undo = undoableReview(workspace);
  const [now] = useState(() => Date.now());
  const attention = area.cards.filter((item) => {
    const status = studyCardStatus(workspace, item, area.id);
    return status.leech || status.suspended;
  });
  const attentionRows = attention.map((item) => (
    <StudyAttentionCard
      key={item.id}
      card={item}
      status={studyCardStatus(workspace, item, area.id)}
      disabled={disabled || controls.busy}
      onEdit={onEdit}
      onToggle={controls.toggleSuspension}
    />
  ));
  return (
    <section className="mb-4 grid gap-3" aria-label="Study tools">
      <StudySyncConflict workspace={workspace} save={save} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={disabled || controls.busy || !undo}
          onClick={() => {
            if (undo)
              controls.commit(
                { kind: "undo-review", eventId: undo.id, operationId: crypto.randomUUID() },
                "Last review undone.",
              );
          }}
        >
          Undo last review
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" disabled={disabled || area.cards.length === 0}>
              Extra practice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Practice {area.title}</DialogTitle>
              <DialogDescription>Practice independently of scheduled reviews.</DialogDescription>
            </DialogHeader>
            <CramPractice area={area} workspace={workspace} mediaStore={mediaStore} save={save} />
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" disabled={disabled}>
              Manage scheduling
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Study management</DialogTitle>
              <DialogDescription>
                {area.title}. Browse cards, adjust schedules, or check your files.
              </DialogDescription>
            </DialogHeader>
            <StudyManagement
              workspace={workspace}
              area={area}
              save={save}
              now={now}
              mediaStore={mediaStore}
              workspaceStore={workspaceStore}
              onPurged={onPurged}
              protectedReferences={protectedReferences}
            />
          </DialogContent>
        </Dialog>
        {card && (
          <Button
            variant="secondary"
            disabled={disabled || controls.busy}
            onClick={() => {
              controls.toggleSuspension(card.id);
            }}
          >
            Suspend this card
          </Button>
        )}
      </div>
      {controls.message && <p role="status">{controls.message}</p>}
      {workspace.schedulerSettings?.activeStudyQuery && (
        <div role="status" className="grid gap-2 border p-3">
          <p>Scheduled review filter: {workspace.schedulerSettings.activeStudyQuery}</p>
          <Button
            variant="secondary"
            disabled={disabled || controls.busy}
            onClick={() => {
              const settings = { ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }) };
              delete settings.activeStudyQuery;
              controls.commit(
                { kind: "update-scheduler-settings", settings },
                "Study filter cleared.",
              );
            }}
          >
            Show all scheduled reviews
          </Button>
        </div>
      )}
      {attention.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="attention">
            <AccordionTrigger>Cards needing attention ({attention.length})</AccordionTrigger>
            <AccordionContent>
              <ul className="grid gap-3">{attentionRows}</ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      <p className="text-sm text-muted-foreground">
        Again means forgotten; Hard means recalled with difficulty. Repeated failures are flagged
        for editing, never suspended automatically.
      </p>
    </section>
  );
}

function StudyAttentionCard({
  card,
  status,
  disabled,
  onEdit,
  onToggle,
}: {
  readonly card: Assessment;
  readonly status: ReturnType<typeof studyCardStatus>;
  readonly disabled: boolean;
  readonly onEdit: (card: Assessment) => void;
  readonly onToggle: (id: Assessment["id"]) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-b pb-2">
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {card.front.slice(0, 150)} · {status.lapses} lapses{status.suspended ? " · suspended" : ""}
      </span>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          onEdit(card);
        }}
      >
        Edit card
      </Button>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          onToggle(card.id);
        }}
      >
        {status.suspended ? "Resume" : "Suspend"}
      </Button>
    </li>
  );
}

function StudyManagement({
  workspace,
  area,
  save,
  now,
  mediaStore,
  protectedReferences,
  workspaceStore,
  onPurged,
}: {
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly save: SaveStudyCommand;
  readonly now: number;
  readonly mediaStore: MediaStore;
  readonly protectedReferences: readonly MediaReference[] | undefined;
}) {
  return (
    <Tabs defaultValue="browse" className="grid min-w-0 gap-5">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="browse">Browse cards</TabsTrigger>
        <TabsTrigger value="schedule">Schedule</TabsTrigger>
        <TabsTrigger value="files">Files</TabsTrigger>
      </TabsList>
      <TabsContent value="browse" forceMount className="data-[state=inactive]:hidden">
        <CardBrowser workspace={workspace} area={area} save={save} now={now} />
      </TabsContent>
      <TabsContent value="schedule" forceMount className="data-[state=inactive]:hidden">
        <ManualScheduling workspace={workspace} area={area} save={save} now={now} />
      </TabsContent>
      <TabsContent value="files" forceMount className="data-[state=inactive]:hidden">
        <CollectionMaintenance
          workspaceStore={workspaceStore}
          onPurged={onPurged}
          protectedReferences={protectedReferences}
          workspace={workspace}
          media={mediaStore}
          save={save}
        />
      </TabsContent>
    </Tabs>
  );
}
