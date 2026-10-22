import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import { Button } from "@recall/ui-web/components/button";
import { startBrowserRecording, type BrowserRecording } from "@/lib/media/browser-recording";
export function PronunciationRecorder({
  onAttach,
  disabled,
}: {
  readonly onAttach: (file: File) => void;
  readonly disabled: boolean;
}) {
  const active = useRef<BrowserRecording | null>(null);
  const mounted = useRef(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) Effect.runSync(active.current.cancel);
    };
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function toggle() {
    setBusy(true);
    setError(null);
    if (active.current) {
      const result = await Effect.runPromise(Effect.either(active.current.stop));
      active.current = null;
      setRecording(false);
      if (Either.isLeft(result)) setError(result.left.message);
      else {
        setDraft(result.right);
        setUrl(URL.createObjectURL(result.right));
      }
    } else {
      const result = await Effect.runPromise(Effect.either(startBrowserRecording()));
      if (!mounted.current) {
        if (Either.isRight(result)) Effect.runSync(result.right.cancel);
        return;
      }
      if (Either.isLeft(result)) setError(result.left.message);
      else {
        active.current = result.right;
        setRecording(true);
        setDraft(null);
      }
    }
    setBusy(false);
  }
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || busy}
        onClick={() => {
          void toggle();
        }}
      >
        {recording ? "Stop recording" : "Record pronunciation"}
      </Button>
      {draft && url && (
        <>
          <audio controls src={url} aria-label="Pronunciation recording preview" />
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              onAttach(draft);
              setDraft(null);
              setUrl(null);
            }}
          >
            Use recording as attachment
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(null);
              setUrl(null);
            }}
          >
            Discard recording
          </Button>
        </>
      )}
      {error && <p role="status">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Preview the recording, attach it, then save the card.
      </p>
    </div>
  );
}
