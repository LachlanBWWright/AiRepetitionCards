import { useLearningActivitiesDraftAutosave } from "./use-learning-activities-draft-autosave";
import { useLearningActivitiesEditorWorkflow } from "./learning-activities-editor-workflow";
import { useLearningActivitiesAttemptWorkflow } from "./learning-activities-attempt-workflow";
import { useLearningActivitiesPersistence } from "./use-learning-activities-persistence";
import { readRef } from "../read-ref";
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
  presentLearningActivity,
  builtinActivityRegistry,
  type ActivityRegistry,
  recommendLearningActivities,
  findActivityPlugin,
  type ActivityServices,
  type ActivityPresentation,
} from "@recall/application";

const builtinIds = new Set(builtinActivityRegistry.map((plugin) => plugin.id));

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
  const [recommendationTime, setRecommendationTime] = useState(0);
  const attemptIdentity = useRef<{
    readonly id: string;
    readonly startedAt: string;
    readonly submittedAt?: string;
    readonly acceptedAt?: string;
  } | null>(null);
  const creationIdentity = useRef<{ readonly id: string; readonly fingerprint: string } | null>(
    null,
  );
  const guard = useRef(false);
  const draftFingerprint = useRef("");
  const editorDraftId = useRef<string | null>(null);
  const editorFingerprint = useRef("");
  const { alive, persist } = useLearningActivitiesPersistence({
    library,
    services,
    onSave,
    setMessage,
    setSyncStatus,
  });
  const authorFields = useMemo(
    () =>
      builtinIds.has(pluginId)
        ? activityAuthoringFields(pluginId)
        : [{ key: "payload", label: "Plugin content (JSON)", initial: "{}", multiline: true }],
    [pluginId],
  );
  useLearningActivitiesDraftAutosave({
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
    editor: {
      creating,
      busy,
      disabled,
      title,
      pluginId,
      objectiveId,
      fields,
      editing,
      areaId,
      authorFields,
    },
    setMessage,
  });
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
    [alive],
  );
  function selectPlugin(id: string) {
    setPluginId(id);
    setFields({});
  }
  const openAttempt = useCallback(
    (entry: LearningActivity, content: ActivityPresentation) => {
      draftFingerprint.current = "";
      setActivity(entry);
      setPresentation(content);
      setResult(null);
      setSuggestedQuestion(null);
      setReferenceShown(false);
      setStage(0);
      setResponse({
        presentedPrompts: content.prompts,
        answers: content.options.length ? [] : content.prompts.map(() => ""),
        selectedOptionIds: [],
        selfScore: 0.5,
        assistance: "none",
      });
      attemptIdentity.current = { id: createId(), startedAt: new Date().toISOString() };
    },
    [createId],
  );
  const { closeEditor, newActivity, resumeEditor, edit, fieldValue, create, wrapCard } =
    useLearningActivitiesEditorWorkflow({
      areaId,
      objectives,
      library,
      registry,
      platform,
      title,
      pluginId,
      objectiveId,
      fields,
      editing,
      authorFields,
      builtinIds,
      createId,
      persist,
      run,
      alive,
      editorDraftId,
      editorFingerprint,
      creationIdentity,
      setCreating,
      setEditing,
      setTitle,
      setPluginId,
      setObjectiveId,
      setFields,
      setMessage,
      openAttempt,
    });
  const openedInitial = useRef<string | null>(null);
  useEffect(() => {
    const clockTimer = setInterval(() => {
      setRecommendationTime(Date.now());
    }, 60_000);
    const initialClockTimer = setTimeout(() => {
      setRecommendationTime(Date.now());
    }, 0);
    return () => {
      clearInterval(clockTimer);
      clearTimeout(initialClockTimer);
    };
  }, []);
  useEffect(() => {
    if (
      !initialActivityId ||
      disabled ||
      busy ||
      activity ||
      creating ||
      openedInitial.current === initialActivityId
    )
      return;
    const entry = library.activities.find(
      (candidate) => candidate.id === initialActivityId && !candidate.archived,
    );
    if (!entry || !findActivityPlugin(registry, entry)?.capabilities.platforms.includes(platform))
      return;
    const timer = setTimeout(() => {
      openedInitial.current = initialActivityId;
      void run(presentLearningActivity(entry, registry), (content) => {
        openAttempt(entry, content);
      });
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [
    initialActivityId,
    disabled,
    busy,
    activity,
    creating,
    library.activities,
    registry,
    platform,
    run,
    openAttempt,
  ]);
  const attemptActions = useLearningActivitiesAttemptWorkflow({
    platform,
    library,
    registry,
    services,
    createId,
    run,
    persist,
    alive,
    attemptIdentity,
    draftFingerprint,
    activity,
    presentation,
    response,
    result,
    stage,
    suggestedQuestion,
    setActivity,
    setPresentation,
    setResponse,
    setResult,
    setStage,
    setReferenceShown,
    setSuggestedQuestion,
    setMessage,
    setSyncStatus,
  });
  const {
    start,
    resume,
    keep,
    hostedAssess,
    followUp,
    approveQuestion,
    archive,
    sync,
    assess,
    accept,
    answer,
    choose,
    leave,
    revise,
    reveal,
  } = attemptActions;
  return {
    library,
    registry,
    activePlugin: activity ? findActivityPlugin(registry, activity) : undefined,
    recommendations: recommendLearningActivities(library, areaId, recommendationTime),
    drafts: (library.drafts ?? []).filter(
      (draft) =>
        draft.activity.areaId === areaId &&
        !library.attempts.some((attempt) => attempt.id === draft.id),
    ),
    suggestedQuestion,
    approveQuestion,
    dismissQuestion: () => {
      setSuggestedQuestion(null);
    },
    followUp,
    hostedAssess,
    sync,
    keep,
    resume,
    archive,
    creating,
    setCreating,
    editing,
    newActivity,
    resumeEditor,
    edit,
    wrapCard,
    closeEditor,
    editorDrafts: (library.editorDrafts ?? []).filter((draft) => draft.areaId === areaId),
    pluginId,
    selectPlugin,
    title,
    setTitle,
    objectiveId,
    setObjectiveId,
    authorFields,
    fieldValue,
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
    create,
    start,
    assess,
    accept,
    answer,
    choose,
    leave,
    revise,
  };
}
