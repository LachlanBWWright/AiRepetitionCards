import { useEffect } from "react";
import type { ActivityLibrary, ActivityResponse, LearningActivity } from "@recall/domain";
import type { ActivityAuthoringField } from "@recall/application";
import { readRef } from "../read-ref";

type AttemptIdentity = {
  readonly id: string;
  readonly startedAt: string;
  readonly submittedAt?: string;
  readonly acceptedAt?: string;
};

type RefCell<Value> = { current: Value };

type EditorDraftState = {
  readonly creating: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly title: string;
  readonly pluginId: string;
  readonly objectiveId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly editing: LearningActivity | null;
  readonly areaId: string;
  readonly authorFields: readonly ActivityAuthoringField[];
};

export function useLearningActivitiesDraftAutosave({
  activity,
  response,
  stage,
  result,
  busy,
  disabled,
  library,
  persist,
  attemptIdentity,
  draftFingerprint,
  alive,
  editorDraftId,
  editorFingerprint,
  editor,
  setMessage,
}: {
  readonly activity: LearningActivity | null;
  readonly response: ActivityResponse;
  readonly stage: number;
  readonly result: unknown;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly library: ActivityLibrary;
  readonly persist: (next: ActivityLibrary) => Promise<boolean>;
  readonly attemptIdentity: RefCell<AttemptIdentity | null>;
  readonly draftFingerprint: RefCell<string>;
  readonly alive: RefCell<boolean>;
  readonly editorDraftId: RefCell<string | null>;
  readonly editorFingerprint: RefCell<string>;
  readonly editor: EditorDraftState;
  readonly setMessage: (message: string | null) => void;
}) {
  useEffect(() => {
    const identity = attemptIdentity.current;
    if (!activity || !identity || result || busy || disabled) return;
    const fingerprint = JSON.stringify({ id: identity.id, activity, response, stage });
    if (fingerprint === draftFingerprint.current) return;
    const timer = setTimeout(() => {
      const draft = {
        id: identity.id,
        activity,
        response,
        stage,
        startedAt: identity.startedAt,
        updatedAt: new Date().toISOString(),
      };
      const next = {
        ...library,
        drafts: [...(library.drafts ?? []).filter((entry) => entry.id !== draft.id), draft],
      };
      void persist(next).then((saved) => {
        if (saved) draftFingerprint.current = fingerprint;
        if (readRef(alive) && !saved)
          setMessage(
            "Progress save not confirmed. Keep this attempt open and retry saving progress.",
          );
      });
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [
    activity,
    response,
    stage,
    result,
    busy,
    disabled,
    library,
    persist,
    attemptIdentity,
    draftFingerprint,
    alive,
    setMessage,
  ]);

  useEffect(() => {
    const id = editorDraftId.current;
    if (!editor.creating || !id || editor.busy || editor.disabled) return;
    const fingerprint = JSON.stringify({
      id,
      title: editor.title,
      pluginId: editor.pluginId,
      objectiveId: editor.objectiveId,
      fields: editor.fields,
      editing: editor.editing,
    });
    if (fingerprint === editorFingerprint.current) return;
    const timer = setTimeout(() => {
      const draft = {
        id,
        areaId: editor.areaId,
        title: editor.title,
        pluginId: editor.pluginId,
        objectiveId: editor.objectiveId,
        fields: Object.fromEntries(
          editor.authorFields.map((field) => [
            field.key,
            editor.fields[field.key] ?? field.initial,
          ]),
        ),
        ...(editor.editing ? { editing: editor.editing } : {}),
        updatedAt: new Date().toISOString(),
      };
      void persist({
        ...library,
        editorDrafts: [...(library.editorDrafts ?? []).filter((entry) => entry.id !== id), draft],
      }).then((saved) => {
        if (saved) editorFingerprint.current = fingerprint;
        if (readRef(alive) && !saved)
          setMessage("Activity draft save not confirmed. Your editor is still open; retry saving.");
      });
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [
    editor.creating,
    editor.busy,
    editor.disabled,
    editor.title,
    editor.pluginId,
    editor.objectiveId,
    editor.fields,
    editor.editing,
    editor.areaId,
    editor.authorFields,
    library,
    persist,
    alive,
    editorDraftId,
    editorFingerprint,
    setMessage,
  ]);
}
