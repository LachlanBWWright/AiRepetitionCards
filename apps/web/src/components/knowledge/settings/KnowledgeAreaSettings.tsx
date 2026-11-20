"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, SubmitEvent } from "react";
import { Effect, Either, Schema } from "effect";
import {
  formatTagInput,
  parseTagInput,
  toKnowledgeArea,
  updateAreaSettings,
  workspaceAuthoringBaseline,
  type AreaSettings,
} from "@recall/application";
import { ObjectiveIdSchema, type LearningArea } from "@recall/domain";
import { Button } from "@/components/ui/Button";
import {
  Alert,
  AlertDescription,
  Input,
  Textarea,
  FieldLabel,
  Field,
  FieldDescription,
} from "@recall/ui-web";
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
import { KnowledgeAreaSettingsObjectives } from "./KnowledgeAreaSettingsObjectives";
import { KnowledgeAreaSettingsAiInstructions } from "./KnowledgeAreaSettingsAiInstructions";

export type AreaSettingsSaveFailure = {
  readonly _tag: "AreaSettingsSaveFailure";
  readonly reason: "stale-content" | "storage" | "paused" | "unavailable";
  readonly message: string;
};

type Props = {
  readonly area: LearningArea;
  readonly onSave: (
    settings: AreaSettings,
    expectedBaseline: string,
  ) => Effect.Effect<LearningArea, AreaSettingsSaveFailure>;
  readonly readLatest?: () => LearningArea | null;
  readonly initialDraftArea?: LearningArea;
  readonly initialSaveFailure?: AreaSettingsSaveFailure;
  readonly createId?: () => string;
};
const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  border: 0,
  padding: 0,
};
const nullable = (value: string): string | null => (value.trim() ? value : null);
const initialSettings = (area: LearningArea): AreaSettings => {
  const exported = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
  return {
    description: area.description ?? null,
    language: area.language ?? "en",
    tags: area.tags ?? [],
    licence: area.licence ?? null,
    attribution: area.attribution ?? null,
    ai: area.ai ?? {
      tutorInstructions: "",
      quizInstructions: null,
      cardGenerationInstructions: null,
    },
    objectives: area.objectives ?? (Either.isRight(exported) ? exported.right.objectives : []),
  };
};

function baselineOf(area: LearningArea): string {
  return (
    workspaceAuthoringBaseline(
      { schemaVersion: 1, reviews: 0, reviewEvents: [], areas: [area] },
      { kind: "update-area-settings", areaId: area.id, settings: initialSettings(area) },
    ) ?? ""
  );
}

/** Mount with an area-specific key when changing the selected area. */
export function KnowledgeAreaSettings({
  area,
  onSave,
  createId = () => crypto.randomUUID(),
  readLatest,
  initialDraftArea,
  initialSaveFailure,
}: Props) {
  const prefix = useId();
  const [draftArea, setDraftArea] = useState(initialDraftArea ?? area);
  const [draft, setDraft] = useState(() => initialSettings(initialDraftArea ?? area));
  const [tags, setTags] = useState(() => formatTagInput((initialDraftArea ?? area).tags ?? []));
  const saving = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "saved";
    readonly text: string;
  } | null>(initialSaveFailure ? { kind: "error", text: initialSaveFailure.message } : null);
  const update = (changes: Partial<AreaSettings>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setFeedback(null);
  };
  const updateDescription = (event: ChangeEvent<HTMLTextAreaElement>) => {
    update({ description: nullable(event.target.value) });
  };
  const updateLanguage = (event: ChangeEvent<HTMLInputElement>) => {
    update({ language: event.target.value });
  };
  const updateTags = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setTags(event.target.value);
    setFeedback(null);
  };
  const updateLicence = (event: ChangeEvent<HTMLInputElement>) => {
    update({ licence: nullable(event.target.value) });
  };
  const updateAttribution = (event: ChangeEvent<HTMLTextAreaElement>) => {
    update({ attribution: nullable(event.target.value) });
  };
  const updateAi = (ai: AreaSettings["ai"]) => {
    update({ ai });
  };
  const updateObjectives = (objectives: AreaSettings["objectives"]) => {
    update({ objectives });
  };
  const addObjective = () => {
    const id = Schema.decodeUnknownEither(ObjectiveIdSchema)(createId());
    if (Either.isLeft(id)) {
      setFeedback({
        kind: "error",
        text: "An objective ID could not be created. Please try again.",
      });
      return;
    }
    update({
      objectives: [
        ...draft.objectives,
        { id: id.right, title: "", description: null, prerequisiteIds: [] },
      ],
    });
  };
  const reload = () => {
    if (saving.current) return;
    const latest = readLatest ? readLatest() : area;
    if (!latest || latest.id !== draftArea.id) {
      setFeedback({
        kind: "error",
        text: "This deck is no longer available. Your draft is preserved.",
      });
      return;
    }
    setDraftArea(latest);
    setDraft(initialSettings(latest));
    setTags(formatTagInput(latest.tags ?? []));
    setFeedback(null);
  };
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    const parsedTags = parseTagInput(tags);
    if (Either.isLeft(parsedTags)) {
      setFeedback({ kind: "error", text: parsedTags.left.message });
      return;
    }
    const settings = { ...draft, tags: parsedTags.right };
    const validated = Effect.runSync(Effect.either(updateAreaSettings(draftArea, settings)));
    if (Either.isLeft(validated)) {
      setFeedback({ kind: "error", text: validated.left.message });
      return;
    }
    saving.current = true;
    setBusy(true);
    setFeedback(null);
    const result = await Effect.runPromise(Effect.either(onSave(settings, baselineOf(draftArea))));
    saving.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (Either.isLeft(result)) {
      setFeedback({ kind: "error", text: result.left.message });
      return;
    }
    setDraftArea(result.right);
    setDraft(initialSettings(result.right));
    setTags(formatTagInput(result.right.tags ?? []));
    setFeedback({ kind: "saved", text: "Settings saved." });
  };
  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      aria-busy={busy}
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <h2 className="m-0 text-lg font-semibold">{area.title} settings</h2>
      <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6 border-0 p-0">
        {feedback && (
          <Alert
            role={feedback.kind === "error" ? "alert" : "status"}
            variant={feedback.kind === "error" ? "destructive" : "default"}
          >
            <AlertDescription>{feedback.text}</AlertDescription>
          </Alert>
        )}
        <section aria-labelledby={`${prefix}-details`} style={panelStyle}>
          <h3 className="m-0 text-base font-semibold" id={`${prefix}-details`}>
            Details
          </h3>
          <FieldLabel style={fieldStyle}>
            Description
            <Textarea rows={3} value={draft.description ?? ""} onChange={updateDescription} />
          </FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel style={fieldStyle}>
              Language
              <Input
                required
                maxLength={80}
                placeholder="en"
                value={draft.language}
                onChange={updateLanguage}
              />
            </FieldLabel>
            <Field style={fieldStyle}>
              <FieldLabel htmlFor={`${prefix}-tags`}>Tags</FieldLabel>
              <Textarea
                id={`${prefix}-tags`}
                aria-describedby={`${prefix}-tags-help`}
                rows={2}
                placeholder="biology, cells"
                value={tags}
                onChange={updateTags}
              />
              <FieldDescription id={`${prefix}-tags-help`}>
                Separate tags with commas.
              </FieldDescription>
            </Field>
            <FieldLabel style={fieldStyle}>
              License
              <Input
                maxLength={120}
                placeholder="e.g. CC BY 4.0"
                value={draft.licence ?? ""}
                onChange={updateLicence}
              />
            </FieldLabel>
            <FieldLabel style={fieldStyle}>
              Attribution
              <Textarea
                rows={2}
                maxLength={500}
                placeholder="Credit the original author or source."
                value={draft.attribution ?? ""}
                onChange={updateAttribution}
              />
            </FieldLabel>
          </div>
        </section>
        <KnowledgeAreaSettingsAiInstructions prefix={prefix} ai={draft.ai} onChange={updateAi} />
        <KnowledgeAreaSettingsObjectives
          prefix={prefix}
          objectives={draft.objectives}
          onChange={updateObjectives}
          onAdd={addObjective}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{busy ? "Saving settings…" : "Save settings"}</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setConfirmReload(true);
            }}
          >
            Reload latest settings
          </Button>
        </div>
      </fieldset>
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved changes will be replaced with the latest deck settings.
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
