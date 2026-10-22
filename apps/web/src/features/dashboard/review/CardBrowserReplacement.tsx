import { useState } from "react";
import { useCardBrowser } from "@recall/react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
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
export function CardBrowserReplacement({
  browser,
}: {
  readonly browser: ReturnType<typeof useCardBrowser>;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Accordion type="single" collapsible>
        <AccordionItem value="replace">
          <AccordionTrigger>Find and replace</AccordionTrigger>
          <AccordionContent className="grid gap-3">
            <ReplacementFields
              browser={browser}
              onReview={() => {
                setConfirm(true);
              }}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace text in {browser.changes.length} cards?</AlertDialogTitle>
            <AlertDialogDescription>
              Apply the displayed replacement to all matching cards. Previous content is retained in
              card version history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!browser.canApply} onClick={browser.apply}>
              Apply replacement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReplacementFields({
  browser,
  onReview,
}: {
  readonly browser: ReturnType<typeof useCardBrowser>;
  readonly onReview: () => void;
}) {
  return (
    <div className="grid gap-3">
      {" "}
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Replace exact text in up to 500 matching cards or source notes. Cloze changes update every
        linked sibling, including cards outside this search.
      </p>
      <Select
        value={browser.field}
        onValueChange={(value) => {
          if (value === "front" || value === "back" || value === "cloze" || value === "note")
            browser.setField(value);
        }}
      >
        <SelectTrigger aria-label="Replacement field">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="front">Front</SelectItem>
          <SelectItem value="back">Back</SelectItem>
          <SelectItem value="cloze">Cloze source</SelectItem>
          <SelectItem value="note">Source note field</SelectItem>
        </SelectContent>
      </Select>
      {browser.field === "note" && (
        <label>
          Source field name
          <Input
            value={browser.noteField}
            onChange={(event) => {
              browser.setNoteField(event.target.value);
            }}
          />
        </label>
      )}
      <label>
        Find
        <Input
          value={browser.find}
          onChange={(event) => {
            browser.setFind(event.target.value);
          }}
        />
      </label>
      <label>
        Replace with
        <Input
          value={browser.replacement}
          onChange={(event) => {
            browser.setReplacement(event.target.value);
          }}
        />
      </label>
      <p>{browser.changes.length} cards would change.</p>
      {browser.changes.slice(0, 3).map((change) => (
        <p className="whitespace-pre-wrap break-words" key={change.card.id}>
          {change.before} → {change.after}
        </p>
      ))}
      <Button
        variant="secondary"
        disabled={!browser.canApply}
        onClick={() => {
          onReview();
        }}
      >
        Review replacement
      </Button>
    </div>
  );
}
