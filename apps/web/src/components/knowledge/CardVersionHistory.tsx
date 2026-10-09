"use client";

import type { CardVersion, Assessment } from "@recall/domain";
import { Effect, Either } from "effect";
import { useId, useRef, useState } from "react";
import { Button } from "../ui/Button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { Alert, AlertDescription } from "@recall/ui-web/components/alert";

export type CardVersionHistoryProps = {
  readonly versions: readonly CardVersion[];
  readonly currentCard?: Assessment | undefined;
  readonly onRestore?: (
    version: CardVersion,
    expectedBaseline: string | undefined,
  ) => Promise<boolean>;
  readonly baselineForVersion?: (version: CardVersion) => string | undefined;
  readonly disabled?: boolean;
  readonly initialSelectedVersionId?: string;
  readonly restoresAsCopy?: boolean;
};

export function CardVersionHistory({
  versions,
  currentCard,
  onRestore,
  baselineForVersion,
  disabled = false,
  initialSelectedVersionId,
  restoresAsCopy = false,
}: CardVersionHistoryProps) {
  const fieldId = useId();
  const [selection, setSelection] = useState<{
    readonly id: string;
    readonly baseline: string | undefined;
  } | null>(() => {
    const initial = versions.find((version) => version.id === initialSelectedVersionId);
    return initial ? { id: initial.id, baseline: baselineForVersion?.(initial) } : null;
  });
  const working = useRef(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    readonly message: string;
    readonly successful: boolean;
  } | null>(null);
  async function restore(version: CardVersion) {
    if (!onRestore || working.current || disabled || !selection) return;
    working.current = true;
    setSaving(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => onRestore(version, selection.baseline),
          catch: () => ({ message: "Could not restore this version." }),
        }),
      ),
    );
    const restored = Either.isRight(result) && result.right;
    working.current = false;
    setSaving(false);
    setNotice({
      message: restored
        ? restoresAsCopy
          ? "Card restored as a new copy."
          : "Card restored."
        : "Could not restore. Reopen the version and try again.",
      successful: restored,
    });
    if (restored) setSelection(null);
  }
  if (versions.length === 0) {
    return (
      <Alert role="status" aria-live="polite">
        <AlertDescription>No earlier versions.</AlertDescription>
      </Alert>
    );
  }
  const selected = versions.find((version) => version.id === selection?.id);
  return (
    <section aria-labelledby={`${fieldId}-title`}>
      <h3 className="text-base font-semibold" id={`${fieldId}-title`}>
        {currentCard ? "Earlier versions" : "Deleted card"}
      </h3>
      <ul className="my-6 list-none space-y-0 p-0">
        {versions.map((version) => (
          <li className="border-b py-4 last:border-b-0" key={version.id}>
            <Button
              size="small"
              variant="secondary"
              onClick={() =>
                setSelection({ id: version.id, baseline: baselineForVersion?.(version) })
              }
              disabled={disabled || saving}
              aria-pressed={selection?.id === version.id}
            >
              <time dateTime={version.recordedAt}>
                {new Date(version.recordedAt).toLocaleString()}
              </time>{" "}
              · {version.reason}
            </Button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="my-4">
          <h4 className="text-sm font-semibold">Selected version</h4>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.card.front}</p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.card.back}</p>
          <p>
            {selected.card.objective}
            {selected.card.tags?.length ? ` · ${selected.card.tags.join(", ")}` : ""}
          </p>
          {currentCard && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button size="small" variant="secondary">
                  Compare current card
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p style={{ whiteSpace: "pre-wrap" }}>{currentCard.front}</p>
                <p style={{ whiteSpace: "pre-wrap" }}>{currentCard.back}</p>
              </CollapsibleContent>
            </Collapsible>
          )}
          <p>
            {restoresAsCopy
              ? "Restore as a new copy with a fresh schedule. Original reviews remain in history."
              : currentCard
                ? "Restore this content. Review history is retained."
                : "Restore this card to your library. Review history is retained."}
          </p>
          {onRestore && (
            <Button
              size="small"
              disabled={disabled || saving}
              onClick={() => void restore(selected)}
            >
              {saving
                ? "Saving…"
                : restoresAsCopy
                  ? "Restore as a new copy"
                  : "Restore this version"}
            </Button>
          )}
        </div>
      )}
      {notice && (
        <Alert
          variant={notice.successful ? "default" : "destructive"}
          role={notice.successful ? "status" : "alert"}
          aria-live={notice.successful ? "polite" : "assertive"}
        >
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
