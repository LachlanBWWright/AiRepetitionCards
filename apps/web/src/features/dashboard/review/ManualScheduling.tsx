import { FieldDescription, FieldError } from "@recall/ui-web/components/field";
import { Label } from "@recall/ui-web/components/label";
import { useManualScheduling } from "@recall/react";
import { useId, useState } from "react";
import { Effect, Either } from "effect";
import type { LearningArea, Workspace } from "@recall/domain";
import { CARD_SEARCH_HELP } from "@recall/application";
import { Input } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@recall/ui-web/components/alert-dialog";
import { type SaveStudyCommand } from "./useStudyCardControls";

export function ManualScheduling({
  workspace,
  area,
  save,
  now,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly save: SaveStudyCommand;
  readonly now: number;
}) {
  const queryErrorId = useId();
  const [confirm, setConfirm] = useState(false);
  const {
    query,
    setQuery,
    due,
    setDue,
    position,
    setPosition,
    error,
    controls,
    matches,
    cards,
    apply,
  } = useManualScheduling({
    workspace,
    area,
    now,
    save: save,
    dueInput: "local",
    createId: () =>
      Effect.try({
        try: () => crypto.randomUUID(),
        catch: () => ({ message: "A scheduling identifier could not be created. Retry." }),
      }),
  });
  return (
    <section className="grid gap-3" aria-label="Manual scheduling">
      <p>
        Adjust matching cards in {area.title}. These actions are administrative changes and never
        count as answers.
      </p>
      <Label className="grid gap-2">
        Find cards to change
        <Input
          aria-invalid={Either.isLeft(matches)}
          aria-describedby={Either.isLeft(matches) ? queryErrorId : undefined}
          value={query}
          maxLength={500}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="is:new or tag:exam"
        />
      </Label>
      <FieldDescription>{CARD_SEARCH_HELP}</FieldDescription>
      {Either.isLeft(matches) ? (
        <FieldError id={queryErrorId}>{matches.left.message}</FieldError>
      ) : (
        <p role="status">
          {cards.length} cards will be affected:{" "}
          {cards
            .slice(0, 3)
            .map((card) => card.front.slice(0, 60))
            .join("; ")}
          {cards.length > 3 ? "; …" : ""}
        </p>
      )}
      <Label className="grid gap-2">
        New due date (this device’s local time)
        <Input
          type="datetime-local"
          value={due}
          onChange={(event) => {
            setDue(event.target.value);
          }}
        />
      </Label>
      <Button
        variant="default"
        disabled={controls.busy || !cards.length || !due}
        onClick={() => {
          apply("due");
        }}
      >
        Set due date for {cards.length} cards
      </Button>
      <Label className="grid gap-2">
        Starting new-card position
        <Input
          type="number"
          min={0}
          max={1000000}
          value={position}
          onChange={(event) => {
            setPosition(event.target.value);
          }}
        />
      </Label>
      <Button
        variant="default"
        disabled={controls.busy || !cards.length || cards.some((card) => card.schedule.state !== 0)}
        onClick={() => {
          apply("reposition");
        }}
      >
        Reposition matching new cards
      </Button>
      <Button
        variant="default"
        disabled={controls.busy || !cards.length}
        onClick={() => {
          setConfirm(true);
        }}
      >
        Reset {cards.length} cards to new…
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {cards.length} cards to new?</AlertDialogTitle>
            <AlertDialogDescription>
              Memory estimates and learning progress will restart. Answer history stays intact. This
              change is retained in your private scheduling log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                apply("reset");
              }}
            >
              Reset cards
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {(error || controls.message) && <p role="status">{error || controls.message}</p>}
    </section>
  );
}
