"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Effect, Either } from "effect";
import { updateSchedulerSettings, workspaceAuthoringBaseline } from "@recall/application";
import type { SchedulerSettings as SchedulerPreferences, Workspace } from "@recall/domain";
import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription, Input } from "@recall/ui-web";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@recall/ui-web/components/alert-dialog";
import { Slider } from "@recall/ui-web/components/slider";

export type SchedulerSettingsSaveFailure = {
  readonly _tag: "SchedulerSettingsSaveFailure";
  readonly reason: "stale-content" | "storage" | "paused" | "unavailable";
  readonly message: string;
};
type Props = {
  readonly workspace: Workspace;
  readonly onSave: (
    settings: SchedulerPreferences,
    expectedBaseline: string,
  ) => Effect.Effect<Workspace, SchedulerSettingsSaveFailure>;
  readonly readLatest?: () => Workspace;
  readonly initialDraft?: {
    readonly retentionPercent: string;
    readonly failure: SchedulerSettingsSaveFailure;
  };
};
const percentText = (workspace: Workspace): string =>
  String(Number(((workspace.schedulerSettings?.requestRetention ?? 0.9) * 100).toPrecision(12)));
const baselineOf = (workspace: Workspace): string =>
  workspaceAuthoringBaseline(workspace, {
    kind: "update-scheduler-settings",
    settings: workspace.schedulerSettings ?? { requestRetention: 0.9 },
  }) ?? "";

/** Keep this editor mounted while synced settings change so an unsaved draft survives. */
export function SchedulerSettings({ workspace, onSave, readLatest, initialDraft }: Props) {
  const prefix = useId();
  const [draftWorkspace, setDraftWorkspace] = useState(workspace);
  const [retentionPercent, setRetentionPercent] = useState(
    () => initialDraft?.retentionPercent ?? percentText(workspace),
  );
  const [busy, setBusy] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "saved";
    readonly text: string;
  } | null>(() => (initialDraft ? { kind: "error", text: initialDraft.failure.message } : null));
  const updateRetention = (value: string) => {
    setRetentionPercent(value);
    setFeedback(null);
  };
  const reload = () => {
    if (saving.current || !readLatest) return;
    const latest = readLatest();
    setDraftWorkspace(latest);
    setRetentionPercent(percentText(latest));
    setFeedback(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    const initialPercent = percentText(draftWorkspace);
    const settings: SchedulerPreferences = {
      requestRetention:
        retentionPercent === initialPercent
          ? (draftWorkspace.schedulerSettings?.requestRetention ?? 0.9)
          : Number(retentionPercent) / 100,
    };
    const validated = Effect.runSync(
      Effect.either(updateSchedulerSettings(draftWorkspace, settings)),
    );
    if (Either.isLeft(validated)) {
      setFeedback({ kind: "error", text: validated.left.message });
      return;
    }
    saving.current = true;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(onSave(settings, baselineOf(draftWorkspace))),
    );
    saving.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (Either.isLeft(result)) {
      setFeedback({ kind: "error", text: result.left.message });
      return;
    }
    setDraftWorkspace(result.right);
    setRetentionPercent(percentText(result.right));
    setFeedback({
      kind: "saved",
      text: "Review settings saved.",
    });
  };

  return (
    <form onSubmit={save} aria-busy={busy} style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 className="mb-2 text-lg font-semibold">Review settings</h2>
      </div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <section
          aria-labelledby={`${prefix}-retention-heading`}
          style={{
            display: "grid",
            gap: 16,
            padding: "12px 0",
          }}
        >
          <h3 className="m-0 text-base font-semibold" id={`${prefix}-retention-heading`}>
            Target retention
          </h3>
          <p id={`${prefix}-retention-help`} style={{ margin: 0 }}>
            Higher targets mean more frequent reviews. Start at 90%.
          </p>
          <label id={`${prefix}-retention-label`}>
            Target retention: <strong>{retentionPercent}%</strong>
          </label>
          <Slider
            id={`${prefix}-retention`}
            min={70}
            max={97}
            step={0.1}
            value={[Number(retentionPercent)]}
            aria-labelledby={`${prefix}-retention-label`}
            aria-describedby={`${prefix}-retention-help ${prefix}-retention-timing`}
            aria-valuetext={`${retentionPercent} percent`}
            onValueChange={([value]) => {
              if (value !== undefined) updateRetention(String(value));
            }}
          />
          <label htmlFor={`${prefix}-retention-number`}>Exact target (%)</label>
          <Input
            id={`${prefix}-retention-number`}
            type="number"
            min={70}
            max={97}
            step="any"
            required
            value={retentionPercent}
            aria-describedby={`${prefix}-retention-help ${prefix}-retention-timing`}
            onChange={(event) => updateRetention(event.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
            <span>70% · fewer reviews</span>
            <span>97% · more reviews</span>
          </div>
          <p id={`${prefix}-retention-timing`} style={{ margin: 0 }}>
            Applies after each card’s next review.
          </p>
        </section>
      </fieldset>
      {feedback && (
        <Alert
          role={feedback.kind === "error" ? "alert" : "status"}
          variant={feedback.kind === "error" ? "destructive" : "default"}
        >
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        {readLatest && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirmReload(true)}
          >
            Reload latest settings
          </Button>
        )}
      </div>
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved changes will be replaced with the latest review settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={reload}>
              Reload settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
