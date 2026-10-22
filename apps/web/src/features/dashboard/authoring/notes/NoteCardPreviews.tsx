import type { NoteCardPreview } from "@recall/application";
import { Either } from "effect";
import type { NoteAuthoringModel } from "@recall/react";
import { CardRichText } from "@/components/cards/CardRichText";

export function NoteCardPreviews({ model }: { readonly model: NoteAuthoringModel }) {
  const cards = Either.isRight(model.preview) ? model.preview.right : [];
  return (
    <div className="grid gap-4">
      {!cards.length ? (
        <p className="text-sm text-muted-foreground" role="status">
          {Either.isLeft(model.preview) && Object.values(model.note.fields).some(Boolean)
            ? model.preview.left.message
            : "Fill in the fields to preview cards."}
        </p>
      ) : (
        cards.map((card) => (
          <PreviewCard
            key={`${card.templateId}:${String(card.deletionIndex ?? 0)}`}
            card={card}
            name={
              model.type.templates.find((template) => template.id === card.templateId)?.name ??
              "Study card"
            }
          />
        ))
      )}
    </div>
  );
}

function PreviewCard({ card, name }: { readonly card: NoteCardPreview; readonly name: string }) {
  return (
    <article
      key={`${card.templateId}:${String(card.deletionIndex ?? 0)}`}
      className="overflow-hidden rounded-xl border border-border bg-background shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <span>{name}</span>
        {card.deletionIndex !== undefined && <span>Deletion {card.deletionIndex}</span>}
      </div>
      <div className="grid gap-2 px-5 py-5">
        <p className="text-xs text-muted-foreground">Question</p>
        <CardRichText
          appearance={card.presentation?.appearance}
          text={card.front}
          className="[font-family:Georgia,serif] text-xl leading-relaxed"
        />
      </div>
      <div className="grid gap-2 border-t border-border px-5 py-5">
        <p className="text-xs text-muted-foreground">Answer</p>
        <CardRichText
          appearance={card.presentation?.appearance}
          text={card.back}
          className="[font-family:Georgia,serif] text-lg leading-relaxed"
        />
      </div>
    </article>
  );
}
