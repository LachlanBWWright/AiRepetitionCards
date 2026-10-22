import { useManualScheduling } from "@recall/react";
import { useState } from "react";
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
      <label>
        Find cards to change
        <Input
          value={query}
          maxLength={500}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="is:new or tag:exam"
        />
      </label>
      <p className="text-sm text-muted-foreground">{CARD_SEARCH_HELP}</p>
      {Either.isLeft(matches) ? (
        <p role="alert">{matches.left.message}</p>
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
      <label>
        New due date (this device’s local time)
        <Input
          type="datetime-local"
          value={due}
          onChange={(event) => {
            setDue(event.target.value);
          }}
        />
      </label>
      <Button
        variant="secondary"
        disabled={controls.busy || !cards.length || !due}
        onClick={() => {
          apply("due");
        }}
      >
        Set due date for {cards.length} cards
      </Button>
      <label>
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
      </label>
      <Button
        variant="secondary"
        disabled={controls.busy || !cards.length || cards.some((card) => card.schedule.state !== 0)}
        onClick={() => {
          apply("reposition");
        }}
      >
        Reposition matching new cards
      </Button>
      <Button
        variant="secondary"
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
