import { Button } from "@recall/ui-web";
import { CardRichText } from "../../../cards/CardRichText";

type Item = { readonly id: string; readonly text: string };
export function OrderingActivity({
  items,
  value,
  disabled,
  onChange,
}: {
  readonly items: readonly Item[];
  readonly value: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (ids: readonly string[]) => void;
}) {
  const complete =
    value.length === items.length &&
    new Set(value).size === items.length &&
    value.every((id) => items.some((item) => item.id === id));
  const ordered = complete ? value.flatMap((id) => items.filter((item) => item.id === id)) : items;
  const move = (index: number, offset: number) => {
    const next = [...ordered];
    const item = next[index];
    const other = next[index + offset];
    if (!item || !other) return;
    next[index] = other;
    next[index + offset] = item;
    onChange(next.map((entry) => entry.id));
  };
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Arrange the steps using Move up and Move down, then check your answer.
      </p>
      <ol className="grid gap-2" aria-label="Your ordering">
        {ordered.map((item, index) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span className="text-sm text-muted-foreground">{index + 1}.</span>
            <CardRichText text={item.text} className="min-w-0 flex-1 text-sm" />
            <div className="flex gap-2">
              <Button
                variant="default"
                disabled={disabled || index === 0}
                aria-label={`Move item ${String(index + 1)} up`}
                onClick={move.bind(null, index, -1)}
              >
                Move up
              </Button>
              <Button
                variant="default"
                disabled={disabled || index === ordered.length - 1}
                aria-label={`Move item ${String(index + 1)} down`}
                onClick={move.bind(null, index, 1)}
              >
                Move down
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button
        variant="default"
        disabled={disabled || complete}
        onClick={() => {
          onChange(ordered.map((item) => item.id));
        }}
      >
        Use this order
      </Button>
      <p role="status" className="text-sm">
        {complete
          ? "Order ready to check."
          : "Move a step or choose Use this order to confirm your response."}
      </p>
    </div>
  );
}
