import type { Assessment } from "@recall/domain";
import type { StudyCardMatch } from "@recall/application";
import { Button } from "@recall/ui-web";
import { CardRichText } from "@/components/cards/CardRichText";
import { useEffect, useRef } from "react";

export function CardBrowserSelection({
  selected,
  onEdit,
  onClose,
}: {
  readonly selected: StudyCardMatch;
  readonly onEdit?: ((card: Assessment) => void) | undefined;
  readonly onClose: () => void;
}) {
  const preview = useRef<HTMLElement>(null);
  useEffect(() => {
    preview.current?.scrollIntoView({ block: "nearest" });
  }, [selected.card.id]);
  return (
    <aside
      ref={preview}
      aria-label="Selected card"
      className="space-y-4 rounded-lg border bg-card p-4 lg:sticky lg:top-0"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{selected.area.title}</p>
        <Button variant="secondary" onClick={onClose}>
          Close preview
        </Button>
      </div>
      <div>
        <h4 className="mb-2 text-sm text-muted-foreground">Question</h4>
        <CardRichText text={selected.card.front} className="text-base leading-7" />
      </div>
      <div>
        <h4 className="mb-2 text-sm text-muted-foreground">Answer</h4>
        <CardRichText text={selected.card.back} className="text-base leading-7" />
      </div>
      {onEdit && (
        <Button
          onClick={() => {
            onEdit(selected.card);
          }}
        >
          Edit selected card
        </Button>
      )}
    </aside>
  );
}
