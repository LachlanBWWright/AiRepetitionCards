import { readRef } from "@/lib/read-ref";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Effect, Either } from "effect";
import {
  emptyActivityLibrary,
  type Assessment,
  type ActivityLibrary,
  type ActivityResponse,
  type LearningActivity,
  type ActivityResult,
} from "@recall/domain";
import {
  activityAuthoringFields,
  builtinActivityRegistry,
  type ActivityRegistry,
  mergeActivityLibraries,
  findActivityPlugin,
  type ActivityServices,
  type ActivityPresentation,
} from "@recall/application";
import { useLearningActivityAttemptActions } from "./use-learning-activities-attempt-actions";
import { useLearningActivitiesDrafts } from "./use-learning-activities-drafts";
import {
  learningActivityBuiltinIds,
  useLearningActivitiesEditorActions,
} from "./use-learning-activities-editor-actions";
import { useLearningActivitiesLibraryActions } from "./use-learning-activities-library-actions";
import { useLearningActivitiesInitialAttempt } from "./use-learning-activities-initial-attempt";
import { getLearningActivityRecommendations } from "./use-learning-activities-recommendations";

export type LearningActivitiesProps = {
  readonly platform?: "web" | "native";
  readonly storageLocation?: "tab" | "device" | "native";
  readonly persistenceStatus?: "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted";
  readonly initialActivityId?: string;
  readonly cards?: readonly Assessment[];
  readonly registry?: ActivityRegistry;
  readonly areaId: string;
  readonly library?: ActivityLibrary;
  readonly objectives: readonly { readonly id: string; readonly title: string }[];
  readonly disabled?: boolean;
  readonly createId: () => string;
  readonly services?: ActivityServices;
  readonly onSave: (library: ActivityLibrary) => Promise<boolean>;
};
export function useLearningActivities({
  areaId,
  platform = "web",
  initialActivityId,
  disabled = false,
  library = emptyActivityLibrary,
  objectives,
  createId,
  onSave,
  services,
  registry = builtinActivityRegistry,
}: LearningActivitiesProps) {
  const [editing, setEditing] = useState<LearningActivity | null>(null);
  const [creating, setCreating] = useState(false);
  const [pluginId, setPluginId] = useState(
    () =>
      registry.find(
        (plugin) =>
          plugin.id === "recall.multiple-choice" &&
          plugin.capabilities.platforms.includes(platform),
      )?.id ??
      registry.find((plugin) => plugin.capabilities.platforms.includes(platform))?.id ??
      "recall.multiple-choice",
  );
  const [title, setTitle] = useState("");
  const [objectiveId, setObjectiveId] = useState(objectives[0]?.id ?? `area:${areaId}:practice`);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});
  const [activity, setActivity] = useState<LearningActivity | null>(null);
  const [presentation, setPresentation] = useState<ActivityPresentation | null>(null);
  const [response, setResponse] = useState<ActivityResponse>({
    answers: [],
    selectedOptionIds: [],
    selfScore: 0.5,
    assistance: "none",
  });
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [referenceShown, setReferenceShown] = useState(false);
  const [stage, setStage] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<
    "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted"
  >(services ? "awaiting-sync" : "saved-locally");
  const [suggestedQuestion, setSuggestedQuestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attemptIdentity = useRef<{
    readonly id: string;
    readonly startedAt: string;
    readonly submittedAt?: string;
    readonly acceptedAt?: string;
  } | null>(null);
  const creationIdentity = useRef<{ readonly id: string; readonly fingerprint: string } | null>(
    null,
  );
  const alive = useRef(true);
  const guard = useRef(false);
  const saveCallback = useRef(onSave);
  useEffect(() => {
    saveCallback.current = onSave;
  }, [onSave]);
  const latestLibrary = useRef(library);
  const saveLane = useRef<Promise<boolean>>(Promise.resolve(true));
  useEffect(() => {
    latestLibrary.current = library;
  }, [library]);
  const authorFields = useMemo(
    () =>
      learningActivityBuiltinIds.has(pluginId)
        ? activityAuthoringFields(pluginId)
        : [{ key: "payload", label: "Plugin content (JSON)", initial: "{}", multiline: true }],
    [pluginId],
  );
  const persist = useCallback(
    async (next: ActivityLibrary, synchronized = false) => {
      const queued = saveLane.current.then(async () => {
        if (!alive.current) return false;
        const saved = await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => saveCallback.current(next),
              catch: () => ({ message: "Save not confirmed." }),
            }),
          ),
        );
        const confirmed = Either.isRight(saved) && saved.right;
        if (confirmed) {
          latestLibrary.current = next;
          setSyncStatus(
            services ? (synchronized ? "synchronized" : "awaiting-sync") : "saved-locally",
          );
        } else setSyncStatus("conflicted");
        return confirmed;
      });
      saveLane.current = queued;
      return queued;
    },
    [services],
  );
  const { draftFingerprint, editorDraftId, editorFingerprint } = useLearningActivitiesDrafts({
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
  });
  useEffect(() => {
    if (!services) return;
    let cancelled = false;
    void Effect.runPromise(
      Effect.either(
        services.read.pipe(
          Effect.flatMap((remote) => mergeActivityLibraries(latestLibrary.current, remote)),
        ),
      ),
    ).then(async (result) => {
      if (!alive.current || cancelled) return;
      if (Either.isLeft(result)) {
        setMessage(result.left.message);
        return;
      }
      const saved = await persist(result.right, true);
      if (readRef(alive) && !saved)
        setMessage(
          "Account activities loaded, but the local save was not confirmed. Retry synchronization.",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [services, persist]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async <A>(
      operation: Effect.Effect<A, { readonly message: string }>,
      success: (value: A) => Promise<void> | void,
      failureStatus?: (error: { readonly message: string }) => void,
    ) => {
      if (guard.current) return;
      guard.current = true;
      setBusy(true);
      setMessage(null);
      const completed = await Effect.runPromise(Effect.either(operation));
      if (!alive.current) return;
      if (Either.isLeft(completed)) {
        setMessage(completed.left.message);
        failureStatus?.(completed.left);
      } else await success(completed.right);
      if (readRef(alive)) {
        guard.current = false;
        setBusy(false);
      }
    },
    [],
  );
  const attemptActions = useLearningActivityAttemptActions({
    library,
    registry,
    platform,
    activity,
    presentation,
    response,
    result,
    stage,
    suggestedQuestion,
    attemptIdentity,
    draftFingerprint,
    alive,
    createId,
    persist,
    run,
    setActivity,
    setPresentation,
    setResponse,
    setResult,
    setStage,
    setSuggestedQuestion,
    setReferenceShown,
    setMessage,
  });
  const {
    openAttempt,
    start,
    resume,
    keep,
    assess,
    accept,
    approveQuestion,
    answer,
    choose,
    revise,
    leave,
    reveal,
  } = attemptActions;
  const editorActions = useLearningActivitiesEditorActions({
    areaId,
    platform,
    objectives,
    library,
    registry,
    fields,
    title,
    pluginId,
    objectiveId,
    editing,
    authorFields,
    builtinIds: learningActivityBuiltinIds,
    createId,
    run,
    persist,
    alive,
    editorDraftId,
    editorFingerprint,
    creationIdentity,
    openAttempt,
    setCreating,
    setEditing,
    setTitle,
    setPluginId,
    setObjectiveId,
    setFields,
    setMessage,
  });
  useLearningActivitiesInitialAttempt({
    initialActivityId,
    disabled,
    busy,
    activity,
    creating,
    library,
    registry,
    platform,
    run,
    openAttempt,
  });
  const libraryActions = useLearningActivitiesLibraryActions({
    activity,
    response,
    library,
    registry,
    services,
    alive,
    attemptIdentity,
    run,
    persist,
    setResult,
    setSuggestedQuestion,
    setSyncStatus,
    setMessage,
  });
  const { hostedAssess, followUp, archive, sync, dismissQuestion } = libraryActions;
  return {
    library,
    registry,
    activePlugin: activity ? findActivityPlugin(registry, activity) : undefined,
    recommendations: getLearningActivityRecommendations(library, areaId, Date.now),
    drafts: (library.drafts ?? []).filter(
      (draft) =>
        draft.activity.areaId === areaId &&
        !library.attempts.some((attempt) => attempt.id === draft.id),
    ),
    suggestedQuestion,
    approveQuestion,
    dismissQuestion,
    followUp,
    hostedAssess,
    sync,
    keep,
    resume,
    archive,
    creating,
    setCreating,
    editing,
    newActivity: editorActions.newActivity,
    resumeEditor: editorActions.resumeEditor,
    edit: editorActions.edit,
    wrapCard: editorActions.wrapCard,
    closeEditor: editorActions.closeEditor,
    editorDrafts: (library.editorDrafts ?? []).filter((draft) => draft.areaId === areaId),
    pluginId,
    selectPlugin: editorActions.selectPlugin,
    title,
    setTitle,
    objectiveId,
    setObjectiveId,
    authorFields,
    fieldValue: editorActions.fieldValue,
    setFields,
    activity,
    presentation,
    response,
    setResponse,
    result,
    setResult,
    referenceShown,
    reveal,
    stage,
    setStage,
    message,
    syncStatus,
    busy,
    create: editorActions.create,
    start,
    assess,
    accept,
    answer,
    choose,
    leave,
    revise,
  };
}
