import type { Assessment } from "@recall/domain";
import { cardFieldAppearance } from "@recall/application";
import { CardRichText } from "./CardRichText";

export function ReviewQuestionContext({
  card,
  mediaUrls,
}: {
  readonly card: Assessment;
  readonly mediaUrls: Readonly<Record<string, string>>;
}) {
  return (
    <div className="mb-6 border-b border-border pb-4" aria-label="Original question">
      <CardRichText
        text={card.front}
        mediaUrls={mediaUrls}
        appearance={cardFieldAppearance(card.presentation, "front")}
        className="text-[15px] leading-6 text-muted-foreground"
      />
    </div>
  );
}
