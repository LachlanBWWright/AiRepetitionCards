import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { Label } from "@recall/ui-web/components/label";
import type { MediaReference } from "@recall/domain";
import { RichTextEditor } from "@/components/cards/RichTextEditor";
import { Input } from "@recall/ui-web/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

type Preview = { readonly front: string; readonly back: string };
type Props = {
  readonly media: readonly MediaReference[];
  readonly cardKind: "basic" | "cloze";
  readonly setCardKind: (kind: "basic" | "cloze") => void;
  readonly generation: number;
  readonly front: string;
  readonly setFront: (value: string) => void;
  readonly back: string;
  readonly explanation: string;
  readonly setExplanation: (value: string) => void;
  readonly setBack: (value: string) => void;
  readonly clozeText: string;
  readonly setClozeText: (value: string) => void;
  readonly clozeIndex: string;
  readonly setClozeIndex: (value: string) => void;
  readonly clozePreview: Preview | null;
};

export function RecallDashboardCardPromptFields(props: Props) {
  return (
    <>
      <div className="flex max-w-sm flex-col gap-2">
        <Label htmlFor="card-kind">Card type</Label>
        <Select
          value={props.cardKind}
          onValueChange={(value) => {
            if (value === "basic" || value === "cloze") props.setCardKind(value);
          }}
        >
          <SelectTrigger id="card-kind" aria-label="Card type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="basic">Question and answer</SelectItem>
            <SelectItem value="cloze">Cloze · fill the gap</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {props.cardKind === "basic" ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="card-front">Question</Label>
            <RichTextEditor
              media={props.media}
              id="card-front"
              className="min-h-32 field-sizing-fixed md:min-h-44 resize-y"
              showPreview={Boolean(props.front.trim())}
              key={`question-${String(props.generation)}`}
              autoFocus
              value={props.front}
              onChange={props.setFront}
              placeholder="What do you want to remember?"
              maxLength={500}
              rows={5}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="card-back">Answer</Label>
            <RichTextEditor
              media={props.media}
              id="card-back"
              className="min-h-32 field-sizing-fixed md:min-h-44 resize-y"
              showPreview={Boolean(props.back.trim())}
              value={props.back}
              onChange={props.setBack}
              placeholder="Write the answer in your own words…"
              maxLength={1500}
              rows={5}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="card-cloze-text">Cloze text</Label>
            <RichTextEditor
              media={props.media}
              id="card-cloze-text"
              key={`cloze-${String(props.generation)}`}
              autoFocus
              value={props.clozeText}
              onChange={props.setClozeText}
              maxLength={10000}
              rows={5}
              placeholder="Mitochondria produce {{c1::ATP::energy molecule}}."
            />
            <p>
              Wrap an answer like {"{{c1::ATP::energy molecule}}"}. Matching numbers hide together;
              other numbers remain visible.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="card-cloze-index">Deletion number to study</Label>
            <Input
              id="card-cloze-index"
              type="number"
              min={1}
              max={20}
              value={props.clozeIndex}
              onChange={(event) => {
                props.setClozeIndex(event.target.value);
              }}
            />
          </div>
          {props.clozePreview ? (
            <section className="flex flex-col gap-2" aria-label="Cloze card preview">
              <strong>Question preview</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{props.clozePreview.front}</p>
              <strong>Answer preview</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{props.clozePreview.back}</p>
            </section>
          ) : (
            <p role="status">
              Add a valid deletion matching the selected number to preview this card.
            </p>
          )}
        </>
      )}
      <Accordion
        type="single"
        collapsible
        defaultValue={props.explanation ? "explanation" : undefined}
      >
        <AccordionItem value="explanation">
          <AccordionTrigger>Explanation (optional)</AccordionTrigger>
          <AccordionContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Add context, a worked example or a source. Shown after revealing the answer.
            </p>
            <Label className="sr-only" htmlFor="card-explanation">
              Explanation (optional)
            </Label>
            <RichTextEditor
              id="card-explanation"
              value={props.explanation}
              onChange={props.setExplanation}
              media={props.media}
              maxLength={10000}
              rows={4}
              placeholder="Explain why, add a worked example, or cite your source…"
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
