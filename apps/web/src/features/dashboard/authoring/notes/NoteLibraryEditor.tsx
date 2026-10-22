import { NoteOwnershipImpact } from "./NoteOwnershipImpact";
import { NoteLifecycleImpact } from "./NoteLifecycleEditor";
import { NoteObjectives } from "./NoteObjectives";
import { NoteAttachments } from "./NoteAttachments";
import { Either } from "effect";
import type { LearningArea } from "@recall/domain";
import { useNoteAuthoring, type NoteAuthoringModel, type NoteAuthoringProps } from "@recall/react";
import { Button } from "@/components/ui/Button";
import { Input } from "@recall/ui-web/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { NoteFields } from "./NoteFields";
import { NoteCardPreviews } from "./NoteCardPreviews";
import { NoteTypeEditor } from "./NoteTypeEditor";

type Props = NoteAuthoringProps & {
  readonly disabled?: boolean | undefined;
  readonly draftsLoaded?: boolean | undefined;
};
export function NoteLibraryEditor(props: Props) {
  if (props.draftsLoaded === false) return <p role="status">Loading saved note drafts…</p>;
  return <LoadedNoteLibraryEditor {...props} />;
}
function LoadedNoteLibraryEditor(props: Props) {
  const model = useNoteAuthoring(props);
  const locked = Boolean(props.disabled) || model.busy;
  return (
    <fieldset disabled={locked} className="grid min-w-0 gap-6">
      <legend className="mb-2 text-xl font-semibold tracking-tight">
        {props.initialNoteId ? "Edit shared note" : "Create from a note"}
      </legend>
      <NoteSourceControls
        area={model.area}
        model={model}
        locked={locked}
        typeLocked={Boolean(props.initialNoteId)}
      />
      <div className="grid min-w-0 gap-5">
        <div className="grid min-w-0 content-start gap-5">
          <NoteFields model={model} disabled={locked} />
          <NoteAttachments model={model} />
          <NoteObjectives area={model.area} model={model} />
          <label className="grid gap-2 text-sm font-medium">
            Tags
            <Input
              value={model.tagsText}
              onChange={(event) => {
                model.setTagsText(event.target.value);
              }}
              placeholder="biology, exam"
            />
          </label>
        </div>
        <Accordion type="single" collapsible>
          <AccordionItem value="preview">
            <AccordionTrigger>Preview cards</AccordionTrigger>
            <AccordionContent>
              <NoteCardPreviews model={model} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <Accordion type="single" collapsible>
        <AccordionItem value="type">
          <AccordionTrigger>Customize fields and templates</AccordionTrigger>
          <AccordionContent>
            <NoteTypeEditor model={model} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <NoteOwnershipImpact model={model} />
      <NoteLifecycleImpact model={model} />
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button
          type="button"
          size="small"
          disabled={
            locked ||
            Either.isLeft(model.preview) ||
            (model.affectsOthers && !model.confirmedTypeChange) ||
            (model.ownershipConflicts.length > 0 && !model.migration?.confirmLinkedSnapshots) ||
            Either.isLeft(model.lifecyclePlan) ||
            (Either.isRight(model.lifecyclePlan) &&
              model.lifecyclePlan.right.requiresConfirmation &&
              !model.migration?.confirmRemoval)
          }
          onClick={() => {
            model.saveNote(false);
          }}
        >
          {model.busy ? "Saving…" : "Save note"}
        </Button>
        <Button
          type="button"
          size="small"
          variant="secondary"
          disabled={
            locked ||
            Either.isLeft(model.preview) ||
            (model.affectsOthers && !model.confirmedTypeChange) ||
            (model.ownershipConflicts.length > 0 && !model.migration?.confirmLinkedSnapshots) ||
            Either.isLeft(model.lifecyclePlan) ||
            (Either.isRight(model.lifecyclePlan) &&
              model.lifecyclePlan.right.requiresConfirmation &&
              !model.migration?.confirmRemoval)
          }
          onClick={() => {
            model.saveNote(true);
          }}
        >
          Save and add another
        </Button>
      </div>
      {model.message && (
        <p className="text-sm text-muted-foreground" role="status">
          {model.message}
        </p>
      )}
    </fieldset>
  );
}

function ExistingNoteOptions({ area }: { readonly area: LearningArea }) {
  return (area.noteLibrary?.notes ?? []).map((note) => (
    <SelectItem key={note.id} value={note.id}>
      {Object.values(note.fields).find(Boolean)?.slice(0, 70) ?? note.id}
    </SelectItem>
  ));
}

function NoteSourceControls({
  area,
  model,
  locked,
  typeLocked,
}: {
  readonly area: LearningArea;
  readonly model: NoteAuthoringModel;
  readonly locked: boolean | undefined;
  readonly typeLocked: boolean;
}) {
  return (
    <div className="grid items-end gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Note type</label>
        <Select
          value={model.type.id}
          disabled={locked || typeLocked}
          onValueChange={model.selectType}
        >
          <SelectTrigger className="w-full" aria-label="Note type">
            <SelectValue placeholder={model.type.name} />
          </SelectTrigger>
          <SelectContent>
            {model.types.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(area.noteLibrary?.notes.length ?? 0) > 0 && (
        <>
          <label className="grid gap-2 text-sm font-medium">
            Open a saved note
            <Select value={model.note.id} disabled={locked} onValueChange={model.selectNote}>
              <SelectTrigger className="w-full" aria-label="Open existing note">
                <SelectValue placeholder="Choose note" />
              </SelectTrigger>
              <SelectContent>
                <ExistingNoteOptions area={area} />
              </SelectContent>
            </Select>
          </label>
        </>
      )}
    </div>
  );
}
