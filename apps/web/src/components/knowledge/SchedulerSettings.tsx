"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Effect, Either } from "effect";
import { updateSchedulerSettings, workspaceAuthoringBaseline } from "@recall/application";
import type { SchedulerSettings as SchedulerPreferences, Workspace } from "@recall/domain";
import { Button } from "@/components/ui/Button";

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
    if (!window.confirm("Discard your draft and load the latest review settings?")) return;
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
      text: "Review settings saved. Future reviews will use this target.",
    });
  };

  return (
    <form onSubmit={save} aria-busy={busy} style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 6 }}>Review settings</h2>
        <p style={{ margin: 0 }}>Choose how often you want to revisit what you learn.</p>
      </div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <section
          aria-labelledby={`${prefix}-retention-heading`}
          style={{
            display: "grid",
            gap: 16,
            border: "1px solid var(--border, #d8ded3)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          <h3 id={`${prefix}-retention-heading`} style={{ margin: 0 }}>
            Target retention
          </h3>
          <p id={`${prefix}-retention-help`} style={{ margin: 0 }}>
            This is the chance of remembering a card when it is due. A higher target means more
            frequent reviews. The recommended starting point is 90%.
          </p>
          <label htmlFor={`${prefix}-retention`}>
            Target retention: <strong>{retentionPercent}%</strong>
          </label>
          <input
            id={`${prefix}-retention`}
            type="range"
            min={70}
            max={97}
            step="any"
            value={retentionPercent}
            aria-describedby={`${prefix}-retention-help ${prefix}-retention-timing`}
            aria-valuetext={`${retentionPercent} percent`}
            onChange={(event) => updateRetention(event.target.value)}
            style={{ width: "100%", accentColor: "var(--accent, #58734a)" }}
          />
          <label htmlFor={`${prefix}-retention-number`}>Exact target (%)</label>
          <input
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
            This applies when you next review a card. Your existing due dates and past review
            history stay unchanged.
          </p>
        </section>
      </fieldset>
      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          style={{ margin: 0, color: feedback.kind === "error" ? "#a12e20" : "inherit" }}
        >
          {feedback.text}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving review settings…" : "Save review settings"}
        </Button>
        {readLatest && (
          <Button variant="secondary" disabled={busy} onClick={reload}>
            Reload latest settings
          </Button>
        )}
      </div>
    </form>
  );
}
