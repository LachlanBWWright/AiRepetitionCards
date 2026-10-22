import type { Assessment } from "@recall/domain";
import { useCardSpeech } from "@recall/react";
import { Button } from "@recall/ui-web/components/button";
import { browserSpeech } from "@/lib/media/browser-speech";
export function ReviewSpeech({
  card,
  revealed,
}: {
  readonly card: Assessment;
  readonly revealed: boolean;
}) {
  const speech = useCardSpeech(card, revealed, browserSpeech);
  if (!speech.enabled) return null;
  return (
    <div className="mb-3 text-center">
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          void speech.speak();
        }}
      >
        Read aloud
      </Button>
      {speech.error && <p role="status">{speech.error}</p>}
    </div>
  );
}
