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
      <label htmlFor="card-kind">Card type</label>
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
      {props.cardKind === "basic" ? (
        <>
          <label htmlFor="card-front">Question</label>
          <RichTextEditor
            media={props.media}
            id="card-front"
            key={`question-${String(props.generation)}`}
            autoFocus
            value={props.front}
            onChange={props.setFront}
            placeholder="What do you want to remember?"
            maxLength={500}
            rows={3}
          />
          <label htmlFor="card-back">Answer</label>
          <RichTextEditor
            media={props.media}
            id="card-back"
            value={props.back}
            onChange={props.setBack}
            placeholder="Write the answer in your own words…"
            maxLength={1500}
            rows={4}
          />
        </>
      ) : (
        <>
          <label htmlFor="card-cloze-text">Cloze text</label>
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
          <label htmlFor="card-cloze-index">Deletion number to study</label>
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
          {props.clozePreview ? (
            <section aria-label="Cloze card preview">
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
    </>
  );
}
