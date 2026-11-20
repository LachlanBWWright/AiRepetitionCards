import { useId } from "react";
import { Label } from "@recall/ui-web";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { CardRichText } from "../../../cards/CardRichText";

type Item = { readonly id: string; readonly text: string };
export function MatchingActivity({
  left,
  right,
  answers,
  disabled,
  onChange,
}: {
  readonly left: readonly Item[];
  readonly right: readonly Item[];
  readonly answers: Readonly<Record<string, string>>;
  readonly disabled: boolean;
  readonly onChange: (leftId: string, rightId: string) => void;
}) {
  const prefix = useId();
  const completed = left.filter((item) => answers[item.id]).length;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Choose one partner for each item. Each partner can be used once.
      </p>
      {left.map((item, index) => (
        <div key={item.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${prefix}-${String(index)}`}>Match {index + 1}</Label>
            <CardRichText text={item.text} className="text-sm" />
          </div>
          <Select
            value={answers[item.id] ?? ""}
            disabled={disabled}
            onValueChange={onChange.bind(null, item.id)}
          >
            <SelectTrigger id={`${prefix}-${String(index)}`} className="h-auto min-h-9">
              <SelectValue placeholder="Choose a partner" />
            </SelectTrigger>
            <SelectContent>
              <MatchingOptions right={right} used={usedPartners(left, item.id, answers)} />
            </SelectContent>
          </Select>
        </div>
      ))}
      <p role="status" className="text-sm">
        {completed} of {left.length} pairs selected.
      </p>
    </div>
  );
}

function MatchingOptions({
  right,
  used,
}: {
  readonly right: readonly Item[];
  readonly used: readonly (string | undefined)[];
}) {
  return right.map((option) => (
    <SelectItem key={option.id} value={option.id} disabled={used.includes(option.id)}>
      <CardRichText text={option.text} className="text-sm" />
    </SelectItem>
  ));
}

function usedPartners(
  left: readonly Item[],
  id: string,
  answers: Readonly<Record<string, string>>,
) {
  return left.filter((item) => item.id !== id).map((item) => answers[item.id]);
}
