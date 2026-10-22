import type { SpeechFieldSettings as Settings } from "@recall/domain";
import { useSpeechVoices } from "@recall/react";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Input } from "@recall/ui-web/components/input";
import { Button } from "@recall/ui-web/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { browserSpeech } from "@/lib/media/browser-speech";
export function SpeechFieldSettings({
  side,
  speech,
  update,
}: {
  readonly side: "front" | "back";
  readonly speech: Settings | undefined;
  readonly update: (value: Settings | undefined) => void;
}) {
  const voices = useSpeechVoices(browserSpeech);
  const voiceOptions = voices.voices.map((voice) => (
    <SelectItem key={voice.id} value={voice.id}>{`${voice.name} (${voice.language})`}</SelectItem>
  ));
  return (
    <fieldset className="grid gap-2 rounded border p-3">
      <legend>{side === "front" ? "Question" : "Answer"} speech</legend>
      <label className="flex gap-2">
        <Checkbox
          checked={speech !== undefined}
          onCheckedChange={(checked) => {
            update(checked === true ? { language: "en-US", rate: 1, autoplay: false } : undefined);
          }}
        />
        Enable read aloud
      </label>
      {speech && (
        <>
          <label>
            Language code
            <Input
              value={speech.language}
              placeholder="en-US"
              maxLength={80}
              onChange={(event) => {
                update({ ...speech, language: event.target.value });
              }}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void voices.refresh();
            }}
          >
            Load device voices
          </Button>
          <Select
            value={speech.voice ?? "default"}
            onValueChange={(voice) => {
              update({ ...speech, voice: voice === "default" ? undefined : voice });
            }}
          >
            <SelectTrigger aria-label={`${side} voice`}>
              <SelectValue placeholder="Default voice" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default voice</SelectItem>
              {voiceOptions}
            </SelectContent>
          </Select>
          <label>
            Speed
            <Input
              type="number"
              min={0.25}
              max={2}
              step={0.25}
              value={speech.rate}
              onChange={(event) => {
                const rate = Number(event.target.value);
                if (rate >= 0.25 && rate <= 2) update({ ...speech, rate });
              }}
            />
          </label>
          <label className="flex gap-2">
            <Checkbox
              checked={speech.autoplay}
              onCheckedChange={(checked) => {
                update({ ...speech, autoplay: checked === true });
              }}
            />
            Read automatically when shown
          </label>
          {voices.error && <p role="status">{voices.error}</p>}
        </>
      )}
    </fieldset>
  );
}
