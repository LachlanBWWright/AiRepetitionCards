import { useState } from "react";
import { FieldDescription } from "@recall/ui-web/components/field";
import { Label } from "@recall/ui-web/components/label";
import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { MediaReference } from "@recall/domain";
import type { LearningArea } from "@/features/workspace/types";
import { Button } from "@/components/ui/Button";
import { CardMediaInput } from "./CardMediaInput";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Textarea } from "@recall/ui-web/components/textarea";

type Props = {
  readonly mediaTools?: ReactNode;
  readonly objectives: LearningArea["objectives"] | undefined;
  readonly objectiveIds: readonly string[];
  readonly setObjectiveIds: Dispatch<SetStateAction<readonly string[]>>;
  readonly tags: string;
  readonly setTags: (value: string) => void;
  readonly sourceMedia: readonly MediaReference[];
  readonly removedMediaIds: readonly string[];
  readonly setRemovedMediaIds: Dispatch<SetStateAction<readonly string[]>>;
  readonly mediaFile: File | null;
  readonly setMediaFile: (file: File | null) => void;
};

function nextObjectiveIds(
  current: readonly string[],
  id: string,
  checked: unknown,
): readonly string[] {
  return checked === true ? [...current, id] : current.filter((currentId) => currentId !== id);
}

function ObjectiveCheckbox({
  id,
  title,
  checked,
  setObjectiveIds,
}: {
  readonly id: string;
  readonly title: string;
  readonly checked: boolean;
  readonly setObjectiveIds: Props["setObjectiveIds"];
}) {
  return (
    <Label className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => {
          setObjectiveIds((current) => nextObjectiveIds(current, id, value));
        }}
      />
      {title}
    </Label>
  );
}

function ObjectiveSelection({
  objectives,
  objectiveIds,
  setObjectiveIds,
}: {
  readonly objectives: LearningArea["objectives"];
  readonly objectiveIds: readonly string[];
  readonly setObjectiveIds: Props["setObjectiveIds"];
}) {
  if (!objectives?.length) return null;
  return (
    <fieldset className="grid gap-2">
      <legend>Learning objectives</legend>
      {objectives.map((objective) => (
        <ObjectiveCheckbox
          key={objective.id}
          id={objective.id}
          title={objective.title}
          checked={objectiveIds.includes(objective.id)}
          setObjectiveIds={setObjectiveIds}
        />
      ))}
    </fieldset>
  );
}

function SourceAttachments({
  sourceMedia,
  removedMediaIds,
  setRemovedMediaIds,
}: Pick<Props, "sourceMedia" | "removedMediaIds" | "setRemovedMediaIds">) {
  return (
    <>
      {sourceMedia
        .filter((reference) => !removedMediaIds.includes(reference.id))
        .map((reference, index) => (
          <div key={reference.id} className="flex justify-between gap-3">
            <span>
              Attachment {index + 1} · {reference.mimeType}
            </span>
            <Button
              type="button"
              onClick={() => {
                setRemovedMediaIds((current) => [...current, reference.id]);
              }}
            >
              Remove attachment
            </Button>
          </div>
        ))}
    </>
  );
}

export function RecallDashboardCardDetails(props: Props) {
  const [section, setSection] = useState("");
  return (
    <Accordion type="single" collapsible value={section} onValueChange={setSection}>
      <AccordionItem value="card-details">
        <AccordionTrigger>Tags, objectives and media</AccordionTrigger>
        <AccordionContent forceMount hidden={section !== "card-details"} className="grid gap-4">
          <ObjectiveSelection
            objectives={props.objectives}
            objectiveIds={props.objectiveIds}
            setObjectiveIds={props.setObjectiveIds}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="card-tags">Tags</Label>
            <Textarea
              rows={2}
              id="card-tags"
              aria-describedby="card-tags-help"
              value={props.tags}
              onChange={(event) => {
                props.setTags(event.target.value);
              }}
              placeholder="e.g. exam, fundamentals"
            />
            <FieldDescription id="card-tags-help">Separate tags with commas.</FieldDescription>
          </div>
          <SourceAttachments
            sourceMedia={props.sourceMedia}
            removedMediaIds={props.removedMediaIds}
            setRemovedMediaIds={props.setRemovedMediaIds}
          />
          <CardMediaInput file={props.mediaFile} onAttach={props.setMediaFile} />
          {props.mediaTools}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
