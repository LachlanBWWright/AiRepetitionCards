import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Effect, Either, Schema } from "effect";
import {
  emptyActivityLibrary,
  type Assessment,
  type ActivityLibrary,
  type ActivityResponse,
  type LearningActivity,
  type LearningAttempt,
  type ActivityResult,
} from "@recall/domain";
import {
  acceptLearningAttempt,
  activityFromCard,
  addLearningActivity,
  assessLearningActivity,
  activityAuthoringFields,
  authorLearningActivity,
  presentLearningActivity,
  builtinActivityRegistry,
  type ActivityRegistry,
  decodeActivityLibrary,
  mergeActivityLibraries,
  recommendLearningActivities,
  reviseLearningActivity,
  validateLearningActivity,
  findActivityPlugin,
  type ActivityServices,
  type ActivityPresentation,
} from "@recall/application";

const builtinIds = new Set(builtinActivityRegistry.map((plugin) => plugin.id));

export type LearningActivitiesProps = {
  readonly platform?: "web" | "native";
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
  const draftFingerprint = useRef("");
  const editorDraftId = useRef<string | null>(null);
  const editorFingerprint = useRef("");
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
      builtinIds.has(pluginId)
        ? activityAuthoringFields(pluginId)
        : [{ key: "payload", label: "Plugin content (JSON)", initial: "{}", multiline: true }],
    [pluginId],
  );
  const persist = useCallback(async (next: ActivityLibrary) => {
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
      if (confirmed) latestLibrary.current = next;
      return confirmed;
    });
    saveLane.current = queued;
    return queued;
  }, []);
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
      const saved = await persist(result.right);
      if (alive.current && !saved)
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
          setMessage(
            "Progress save not confirmed. Keep this attempt open and retry saving progress.",
          );
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [activity, response, stage, result, busy, disabled, library, persist]);
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
    return () => clearTimeout(timer);
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
  ]);
  function closeEditor() {
    const id = editorDraftId.current;
    if (!id) {
      setCreating(false);
      return;
    }
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
    void run(
      decodeActivityLibrary({
        ...library,
        editorDrafts: [...(library.editorDrafts ?? []).filter((entry) => entry.id !== id), draft],
      }),
      async (next) => {
        if (await persist(next)) {
          if (alive.current) {
            setCreating(false);
            setMessage("Activity draft saved.");
          }
        } else if (alive.current)
          setMessage("Draft save not confirmed. Your editor is still open; retry.");
      },
    );
  }
  function newActivity() {
    editorDraftId.current = createId();
    editorFingerprint.current = "";
    setObjectiveId(objectives[0]?.id ?? `area:${areaId}:practice`);
    setEditing(null);
    setTitle("");
    setFields({});
    setCreating(true);
  }
  function resumeEditor(id: string) {
    const draft = library.editorDrafts?.find((entry) => entry.id === id);
    if (!draft) return;
    editorDraftId.current = id;
    editorFingerprint.current = "";
    setEditing(draft.editing ?? null);
    setTitle(draft.title);
    setPluginId(draft.pluginId);
    setObjectiveId(draft.objectiveId);
    setFields(draft.fields);
    setCreating(true);
  }
  function supports(entry: LearningActivity) {
    return findActivityPlugin(registry, entry)?.capabilities.platforms.includes(platform) === true;
  }
  function edit(entry: LearningActivity) {
    if (!supports(entry)) {
      setMessage("This plugin is unavailable on this platform. Content and history are preserved.");
      return;
    }
    void run(presentLearningActivity(entry, registry), (content) => {
      editorDraftId.current = createId();
      setEditing(entry);
      setTitle(entry.title);
      setPluginId(entry.pluginId);
      setObjectiveId(entry.objectiveIds[0] ?? `area:${areaId}:practice`);
      editorFingerprint.current = "";
      setFields(
        builtinIds.has(entry.pluginId)
          ? {
              prompt: content.prompts.join("\n\n"),
              rubric: content.rubric,
              reference: content.reference,
              options: content.options.map((option) => option.text).join("\n"),
              correct: Array.isArray(entry.payload.correctOptionIds)
                ? content.options
                    .flatMap((option, index) =>
                      Array.isArray(entry.payload.correctOptionIds) &&
                      entry.payload.correctOptionIds.includes(option.id)
                        ? [String(index + 1)]
                        : [],
                    )
                    .join(",")
                : "",
              tests: JSON.stringify(entry.payload.tests ?? []),
            }
          : { payload: JSON.stringify(entry.payload, null, 2) },
      );
      setCreating(true);
    });
  }
  function wrapCard(card: Assessment) {
    const proposal = activityFromCard(card, areaId);
    const existing = library.activities.find((entry) => entry.id === proposal.id);
    const entry = existing ? { ...proposal, revision: existing.revision + 1 } : proposal;
    void run(
      existing
        ? reviseLearningActivity(library, entry, existing.revision, registry)
        : addLearningActivity(library, entry, registry),
      async (next) => {
        if (await persist(next)) {
          if (alive.current) {
            const presented = await Effect.runPromise(
              Effect.either(presentLearningActivity(entry, registry)),
            );
            if (Either.isRight(presented)) openAttempt(entry, presented.right);
            else setMessage(presented.left.message);
          }
        } else if (alive.current) setMessage("Card activity save not confirmed; retry.");
      },
    );
  }
  const fieldValue = (key: string) =>
    fields[key] ?? authorFields.find((field) => field.key === key)?.initial ?? "";
  function selectPlugin(id: string) {
    setPluginId(id);
    setFields({});
  }
  const run = useCallback(
    async <A>(
      operation: Effect.Effect<A, { readonly message: string }>,
      success: (value: A) => Promise<void> | void,
    ) => {
      if (guard.current) return;
      guard.current = true;
      setBusy(true);
      setMessage(null);
      const completed = await Effect.runPromise(Effect.either(operation));
      if (!alive.current) return;
      if (Either.isLeft(completed)) setMessage(completed.left.message);
      else await success(completed.right);
      if (alive.current) {
        guard.current = false;
        setBusy(false);
      }
    },
    [],
  );
  function create() {
    const fingerprint = JSON.stringify({ areaId, title, pluginId, objectiveId, fields });
    const id =
      editing?.id ??
      editorDraftId.current ??
      (creationIdentity.current?.fingerprint === fingerprint
        ? creationIdentity.current.id
        : createId());
    creationIdentity.current = { id, fingerprint };
    void run(
      (builtinIds.has(pluginId)
        ? authorLearningActivity(
            {
              id,
              areaId,
              title,
              pluginId,
              objectiveId,
              fields: Object.fromEntries(
                authorFields.map((field) => [field.key, fieldValue(field.key)]),
              ),
            },
            registry,
          )
        : Schema.decodeUnknown(Schema.parseJson(Schema.Unknown))(fieldValue("payload")).pipe(
            Effect.mapError(() => ({ message: "Plugin content must be valid JSON." })),
            Effect.flatMap((payload) =>
              validateLearningActivity(
                {
                  id,
                  areaId,
                  title: title.trim(),
                  pluginId,
                  pluginVersion:
                    editing?.pluginVersion ??
                    registry
                      .filter((plugin) => plugin.id === pluginId)
                      .reduce((latest, plugin) => Math.max(latest, plugin.version), 1),
                  revision: 1,
                  objectiveIds: [objectiveId],
                  fallback: title.trim(),
                  payload,
                },
                registry,
              ),
            ),
          )
      ).pipe(
        Effect.map((entry) =>
          editing
            ? {
                ...entry,
                pluginVersion: editing.pluginVersion,
                objectiveIds: [
                  objectiveId,
                  ...editing.objectiveIds.filter(
                    (id) => id !== editing.objectiveIds[0] && id !== objectiveId,
                  ),
                ],
                ...(editing.archived === undefined ? {} : { archived: editing.archived }),
              }
            : entry,
        ),
        Effect.flatMap((entry) =>
          editing
            ? reviseLearningActivity(
                library,
                { ...entry, revision: editing.revision + 1 },
                editing.revision,
                registry,
              )
            : addLearningActivity(library, entry, registry),
        ),
        Effect.map((next) => ({
          ...next,
          editorDrafts: (next.editorDrafts ?? []).filter(
            (draft) => draft.id !== editorDraftId.current,
          ),
        })),
      ),
      async (next) => {
        const saved = await persist(next);
        if (!alive.current) return;
        if (saved) {
          setCreating(false);
          setTitle("");
          setFields({});
          setMessage("Activity saved.");
        } else
          setMessage(
            "Save not confirmed. Your activity is retained here; retry saving before leaving.",
          );
      },
    );
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
  const openedInitial = useRef<string | null>(null);
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
    openedInitial.current = initialActivityId;
    void run(presentLearningActivity(entry, registry), (content) => openAttempt(entry, content));
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
  function start(entry: LearningActivity) {
    if (!supports(entry)) {
      setMessage("This plugin is unavailable on this platform. Content and history are preserved.");
      return;
    }
    void run(presentLearningActivity(entry, registry), (content) => openAttempt(entry, content));
  }
  function resume(id: string) {
    const draft = library.drafts?.find((entry) => entry.id === id);
    if (!draft || !supports(draft.activity)) return;
    void run(presentLearningActivity(draft.activity, registry), (content) => {
      draftFingerprint.current = "";
      setActivity(draft.activity);
      setPresentation({ ...content, prompts: draft.response.presentedPrompts ?? content.prompts });
      setResponse(draft.response);
      setStage(draft.stage);
      setReferenceShown(draft.response.assistance === "answer-revealed");
      setResult(null);
      setSuggestedQuestion(null);
      attemptIdentity.current = { id: draft.id, startedAt: draft.startedAt };
    });
  }
  function keep() {
    const identity = attemptIdentity.current;
    if (!activity || !identity || result) return;
    const draft = {
      id: identity.id,
      activity,
      response,
      stage,
      startedAt: identity.startedAt,
      updatedAt: new Date().toISOString(),
    };
    void run(
      decodeActivityLibrary({
        ...library,
        drafts: [...(library.drafts ?? []).filter((entry) => entry.id !== draft.id), draft],
      }),
      async (next) => {
        if (await persist(next)) {
          if (alive.current) {
            leave();
            setMessage("Progress saved. Resume this attempt later.");
          }
        } else if (alive.current)
          setMessage("Progress save not confirmed. Your attempt is still open; retry.");
      },
    );
  }
  function hostedAssess() {
    if (!activity || !services) return;
    void run(services.assess(activity, response), (value) => {
      setResult(value);
      const identity = attemptIdentity.current;
      if (identity)
        attemptIdentity.current = { ...identity, submittedAt: new Date().toISOString() };
    });
  }
  function followUp() {
    if (!activity || !services) return;
    void run(services.question(activity, response), (question) => setSuggestedQuestion(question));
  }
  function approveQuestion() {
    if (!suggestedQuestion || !presentation || result || presentation.prompts.length >= 10) return;
    const prompts = [...presentation.prompts, suggestedQuestion];
    setPresentation({ ...presentation, prompts });
    setResponse((current) => ({
      ...current,
      presentedPrompts: prompts,
      answers: [...current.answers, ""],
    }));
    setStage(prompts.length - 1);
    setSuggestedQuestion(null);
  }
  function archive(entry: LearningActivity) {
    void run(
      reviseLearningActivity(
        library,
        { ...entry, archived: !entry.archived, revision: entry.revision + 1 },
        entry.revision,
        registry,
      ),
      async (next) => {
        if (await persist(next)) {
          if (alive.current)
            setMessage(
              entry.archived
                ? "Activity restored."
                : "Activity archived. Attempt history is preserved.",
            );
        } else if (alive.current) setMessage("Archive save not confirmed; retry.");
      },
    );
  }
  function sync() {
    if (!services) return;
    void run(services.sync(library), async (next) => {
      if (await persist(next)) {
        if (alive.current) setMessage("Activities synchronized.");
      } else if (alive.current) setMessage("Local save not confirmed. Retry synchronization.");
    });
  }
  function assess() {
    if (!activity) return;
    void run(assessLearningActivity(activity, response, registry), (value) => {
      setResult(value);
      const identity = attemptIdentity.current;
      if (identity)
        attemptIdentity.current = { ...identity, submittedAt: new Date().toISOString() };
    });
  }
  function accept() {
    const identity = attemptIdentity.current;
    if (!activity || !result || !identity?.submittedAt) return;
    const acceptedAt = identity.acceptedAt ?? new Date().toISOString();
    attemptIdentity.current = { ...identity, acceptedAt };
    const attempt: LearningAttempt = {
      id: identity.id,
      activity,
      response,
      result,
      startedAt: identity.startedAt,
      submittedAt: identity.submittedAt,
      acceptedAt,
    };
    void run(acceptLearningAttempt(library, attempt, registry), async (next) => {
      const saved = await persist(next);
      if (!alive.current) return;
      if (saved) {
        setActivity(null);
        setPresentation(null);
        setResult(null);
        setMessage("Attempt recorded. Review schedules are unchanged.");
      } else
        setMessage(
          "Save not confirmed. Your result is retained; retry recording it before leaving.",
        );
    });
  }
  function answer(index: number, value: string) {
    setResponse((current) => ({
      ...current,
      answers: current.answers.map((entry, position) => (position === index ? value : entry)),
    }));
  }
  function choose(id: string) {
    setResponse((current) => ({
      ...current,
      selectedOptionIds: current.selectedOptionIds.includes(id)
        ? current.selectedOptionIds.filter((entry) => entry !== id)
        : [...current.selectedOptionIds, id],
    }));
  }
  function revise() {
    setResult(null);
    setResponse((current) => ({ ...current, assistance: "answer-revealed" }));
    const previous = attemptIdentity.current;
    attemptIdentity.current = {
      id:
        previous && !library.attempts.some((attempt) => attempt.id === previous.id)
          ? previous.id
          : createId(),
      startedAt: previous?.startedAt ?? new Date().toISOString(),
    };
  }
  function leave() {
    setActivity(null);
    setPresentation(null);
    setResult(null);
    setMessage(null);
  }
  function reveal() {
    setReferenceShown(true);
    setResponse((current) => ({ ...current, assistance: "answer-revealed" }));
  }
  return {
    library,
    registry,
    activePlugin: activity ? findActivityPlugin(registry, activity) : undefined,
    recommendations: recommendLearningActivities(library, areaId, Date.now()),
    drafts: (library.drafts ?? []).filter(
      (draft) =>
        draft.activity.areaId === areaId &&
        !library.attempts.some((attempt) => attempt.id === draft.id),
    ),
    suggestedQuestion,
    approveQuestion,
    dismissQuestion: () => setSuggestedQuestion(null),
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
