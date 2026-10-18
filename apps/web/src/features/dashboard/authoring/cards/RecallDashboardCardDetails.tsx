import type { Dispatch, SetStateAction } from "react";
import type { MediaReference } from "@recall/domain";
import type { LearningArea } from "@/features/workspace/types";
import { Button } from "@/components/ui/Button";
import { MediaFilePreview } from "@/features/dashboard/layout/RecallDashboardSupport";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Textarea } from "@recall/ui-web/components/textarea";

type Props = {
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
    <label className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => {
          setObjectiveIds((current) => nextObjectiveIds(current, id, value));
        }}
      />
      {title}
    </label>
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
    <fieldset>
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
              className="inline-flex min-h-8 items-center rounded-md px-2 text-sm text-[var(--ink)] underline-offset-4 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
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
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="card-details">
        <AccordionTrigger>Card details</AccordionTrigger>
        <AccordionContent>
          <ObjectiveSelection
            objectives={props.objectives}
            objectiveIds={props.objectiveIds}
            setObjectiveIds={props.setObjectiveIds}
          />
          <label htmlFor="card-tags">Tags</label>
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
          <small id="card-tags-help">Separate tags with commas.</small>
          <SourceAttachments
            sourceMedia={props.sourceMedia}
            removedMediaIds={props.removedMediaIds}
            setRemovedMediaIds={props.setRemovedMediaIds}
          />
          <label htmlFor="card-media">Attach image or audio (20 MB max)</label>
          <input
            id="card-media"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,audio/mpeg,audio/ogg,audio/wav"
            onChange={(event) => {
              props.setMediaFile(event.currentTarget.files?.[0] ?? null);
            }}
          />
          {props.mediaFile && <MediaFilePreview file={props.mediaFile} />}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
