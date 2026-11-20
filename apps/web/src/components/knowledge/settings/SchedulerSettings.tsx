"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { Effect, Either } from "effect";
import {
  updateSchedulerSettings,
  workspaceAuthoringBaseline,
  schedulerSettingsDraft,
} from "@recall/application";
import type { SchedulerSettings as SchedulerPreferences, Workspace } from "@recall/domain";
import { FormActions, WorkflowSections } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
import { Alert, AlertDescription, Input, FieldLabel, FieldDescription } from "@recall/ui-web";
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
import { ReviewerSettingsFields } from "./ReviewerSettingsFields";
import { StudyPolicyFields } from "./StudyPolicyFields";
import { ParameterFittingPanel } from "./ParameterFittingPanel";
import { AdvancedSchedulingFields } from "./AdvancedSchedulingFields";
import { StudyPresetEditor } from "./StudyPresetEditor";

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
  const [studySettings, setStudySettings] = useState<SchedulerPreferences>(
    workspace.schedulerSettings ?? { requestRetention: 0.9 },
  );
  const [retentionPercent, setRetentionPercent] = useState(
    () => initialDraft?.retentionPercent ?? percentText(workspace),
  );
  const effectiveSettings = schedulerSettingsDraft(studySettings, { retentionPercent });
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
    setStudySettings(latest.schedulerSettings ?? { requestRetention: 0.9 });
    setRetentionPercent(percentText(latest));
    setFeedback(null);
  };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    const settings = effectiveSettings;
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
    setStudySettings(result.right.schedulerSettings ?? { requestRetention: 0.9 });
    setRetentionPercent(percentText(result.right));
    setFeedback({
      kind: "saved",
      text: "Review settings saved.",
    });
  };

  const sectionContent1 = (
    <>
      <section
        aria-labelledby={`${prefix}-retention-heading`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h3 className="m-0 text-base font-semibold" id={`${prefix}-retention-heading`}>
          Target retention
        </h3>
        <FieldDescription id={`${prefix}-retention-help`} style={{ margin: 0 }}>
          Higher targets mean more frequent reviews. Start at 90%.
        </FieldDescription>
        <div className="flex flex-col gap-2">
          <FieldLabel id={`${prefix}-retention-label`}>
            Target retention: <strong>{retentionPercent}%</strong>
          </FieldLabel>
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
        </div>
        <FieldLabel className="flex flex-col gap-2" htmlFor={`${prefix}-retention-number`}>
          Exact target (%)
          <Input
            id={`${prefix}-retention-number`}
            type="number"
            min={70}
            max={97}
            step="any"
            required
            value={retentionPercent}
            aria-describedby={`${prefix}-retention-help ${prefix}-retention-timing`}
            onChange={(event) => {
              updateRetention(event.target.value);
            }}
          />
        </FieldLabel>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
          <span>70% · fewer reviews</span>
          <span>97% · more reviews</span>
        </div>
        <FieldDescription id={`${prefix}-retention-timing`} style={{ margin: 0 }}>
          Applies after each card’s next review.
        </FieldDescription>
      </section>
      <StudyPolicyFields settings={effectiveSettings} onChange={setStudySettings} />
    </>
  );
  const sectionContent2 = (
    <>
      <ReviewerSettingsFields settings={effectiveSettings} onChange={setStudySettings} />
      <AdvancedSchedulingFields
        key={`advanced:${JSON.stringify(draftWorkspace.schedulerSettings)}`}
        policy={effectiveSettings}
        onChange={(policy) => {
          setStudySettings({ ...studySettings, ...policy });
        }}
      />
    </>
  );
  const sectionContent3 = (
    <>
      <StudyPresetEditor
        workspace={draftWorkspace}
        settings={effectiveSettings}
        onChange={setStudySettings}
      />
    </>
  );
  const sectionContent4 = (
    <>
      <ParameterFittingPanel
        key={`fitting:${JSON.stringify(draftWorkspace.schedulerSettings)}`}
        workspace={draftWorkspace}
        settings={effectiveSettings}
        onChange={setStudySettings}
      />
    </>
  );
  return (
    <form
      onSubmit={(event) => {
        void save(event);
      }}
      aria-busy={busy}
      className="mx-auto flex flex-col w-full max-w-3xl gap-6"
    >
      <h2 className="m-0 text-lg font-semibold">Review settings</h2>
      <fieldset disabled={busy} className="flex flex-col min-w-0 gap-6 border-0 p-0">
        <WorkflowSections
          label="Review settings sections"
          sections={[
            {
              id: "daily",
              label: "Daily study",
              content: sectionContent1,
            },
            {
              id: "scheduling",
              label: "Scheduling",
              content: sectionContent2,
            },
            {
              id: "presets",
              label: "Presets",
              content: sectionContent3,
            },
            {
              id: "fitting",
              label: "Personalization",
              content: sectionContent4,
            },
          ]}
        />
      </fieldset>
      {feedback && (
        <Alert
          role={feedback.kind === "error" ? "alert" : "status"}
          variant={feedback.kind === "error" ? "destructive" : "default"}
        >
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}
      <FormActions className="sticky bottom-0 z-10 border-t bg-background py-3">
        {readLatest && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setConfirmReload(true);
            }}
          >
            Reload latest settings
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </FormActions>
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
