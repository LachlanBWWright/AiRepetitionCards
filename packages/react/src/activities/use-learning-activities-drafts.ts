"use client";

import { useEffect, useRef } from "react";
import type {
  ActivityLibrary,
  ActivityResponse,
  LearningActivity,
  ActivityResult,
} from "@recall/domain";

type AuthorField = { readonly key: string; readonly initial: string };

type UseLearningActivityDraftsOptions = {
  readonly areaId: string;
  readonly library: ActivityLibrary;
  readonly activity: LearningActivity | null;
  readonly response: ActivityResponse;
  readonly stage: number;
  readonly result: ActivityResult | null;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly creating: boolean;
  readonly title: string;
  readonly pluginId: string;
  readonly objectiveId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly editing: LearningActivity | null;
  readonly authorFields: readonly AuthorField[];
  readonly alive: { current: boolean };
  readonly attemptIdentity: {
    current: {
      readonly id: string;
      readonly startedAt: string;
      readonly submittedAt?: string;
      readonly acceptedAt?: string;
    } | null;
  };
  readonly persist: (library: ActivityLibrary) => Promise<boolean>;
  readonly setMessage: (message: string | null) => void;
};

export function useLearningActivitiesDrafts({
  areaId,
  library,
  activity,
  response,
  stage,
  result,
  busy,
  disabled,
  creating,
  title,
  pluginId,
  objectiveId,
  fields,
  editing,
  authorFields,
  alive,
  attemptIdentity,
  persist,
  setMessage,
}: UseLearningActivityDraftsOptions) {
  const draftFingerprint = useRef("");
  const editorDraftId = useRef<string | null>(null);
  const editorFingerprint = useRef("");

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
        if (alive.current && !saved)
          setMessage("Progress save not confirmed. Keep this attempt open and retry saving.");
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
    alive,
    attemptIdentity,
    setMessage,
  ]);

  useEffect(() => {
    const id = editorDraftId.current;
    if (!creating || !id || busy || disabled) return;
    const fingerprint = JSON.stringify({ id, title, pluginId, objectiveId, fields, editing });
    if (fingerprint === editorFingerprint.current) return;
    const timer = setTimeout(() => {
      const draft = {
        id,
        areaId,
        title,
        pluginId,
        objectiveId,
        fields: Object.fromEntries(
          authorFields.map((field) => [field.key, fields[field.key] ?? field.initial]),
        ),
        ...(editing ? { editing } : {}),
        updatedAt: new Date().toISOString(),
      };
      void persist({
        ...library,
        editorDrafts: [...(library.editorDrafts ?? []).filter((entry) => entry.id !== id), draft],
      }).then((saved) => {
        if (saved) editorFingerprint.current = fingerprint;
        if (alive.current && !saved)
          setMessage("Activity draft save not confirmed. Your editor is still open; retry saving.");
      });
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [
    creating,
    busy,
    disabled,
    title,
    pluginId,
    objectiveId,
    fields,
    editing,
    areaId,
    library,
    persist,
    authorFields,
    alive,
    setMessage,
  ]);

  return { draftFingerprint, editorDraftId, editorFingerprint };
}
