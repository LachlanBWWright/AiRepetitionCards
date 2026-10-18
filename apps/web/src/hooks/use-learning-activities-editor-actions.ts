import { Effect, Either } from "effect";
import {
  activityFromCard,
  addLearningActivity,
  activityAuthoringFields,
  builtinActivityRegistry,
  decodeActivityLibrary,
  findActivityPlugin,
  presentLearningActivity,
  reviseLearningActivity,
  type ActivityPresentation,
  type ActivityRegistry,
} from "@recall/application";
import type { ActivityLibrary, Assessment, LearningActivity } from "@recall/domain";
import type { Dispatch, SetStateAction } from "react";
import { readRef } from "@/lib/read-ref";
import { createLearningActivity } from "./use-learning-activities-create";

type Run = <A>(
  operation: Effect.Effect<A, { readonly message: string }>,
  success: (value: A) => Promise<void> | void,
) => Promise<void>;

type EditorField = ReturnType<typeof activityAuthoringFields>[number];

export const learningActivityBuiltinIds = new Set(
  builtinActivityRegistry.map((plugin) => plugin.id),
);

export type LearningActivityEditorActionDependencies = {
  readonly areaId: string;
  readonly platform: "web" | "native";
  readonly objectives: readonly { readonly id: string; readonly title: string }[];
  readonly library: ActivityLibrary;
  readonly registry: ActivityRegistry;
  readonly fields: Readonly<Record<string, string>>;
  readonly title: string;
  readonly pluginId: string;
  readonly objectiveId: string;
  readonly editing: LearningActivity | null;
  readonly authorFields: readonly EditorField[];
  readonly builtinIds: ReadonlySet<string>;
  readonly createId: () => string;
  readonly run: Run;
  readonly persist: (next: ActivityLibrary, synchronized?: boolean) => Promise<boolean>;
  readonly alive: { current: boolean };
  readonly editorDraftId: { current: string | null };
  readonly editorFingerprint: { current: string };
  readonly creationIdentity: {
    current: { readonly id: string; readonly fingerprint: string } | null;
  };
  readonly openAttempt: (entry: LearningActivity, content: ActivityPresentation) => void;
  readonly setCreating: Dispatch<SetStateAction<boolean>>;
  readonly setEditing: Dispatch<SetStateAction<LearningActivity | null>>;
  readonly setTitle: Dispatch<SetStateAction<string>>;
  readonly setPluginId: Dispatch<SetStateAction<string>>;
  readonly setObjectiveId: Dispatch<SetStateAction<string>>;
  readonly setFields: Dispatch<SetStateAction<Readonly<Record<string, string>>>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
};

export function useLearningActivitiesEditorActions(
  dependencies: LearningActivityEditorActionDependencies,
) {
  const {
    areaId,
    objectives,
    library,
    registry,
    fields,
    title,
    pluginId,
    objectiveId,
    editing,
    authorFields,
    builtinIds,
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
  } = dependencies;

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
          if (readRef(alive)) {
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
    return (
      findActivityPlugin(registry, entry)?.capabilities.platforms.includes(
        dependencies.platform,
      ) === true
    );
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
              correct: correctOptionIndexes(entry, content),
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
          if (readRef(alive)) {
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

  function create() {
    createLearningActivity({
      areaId,
      title,
      pluginId,
      objectiveId,
      fields,
      editing,
      editorDraftId: editorDraftId.current,
      createId,
      builtinIds,
      authorFields,
      registry,
      library,
      run,
      persist,
      isAlive: () => alive.current,
      setCreating,
      setTitle,
      setFields,
      setMessage: (message) => {
        setMessage(message);
      },
      creationIdentity,
    });
  }

  return {
    closeEditor,
    newActivity,
    resumeEditor,
    edit,
    wrapCard,
    fieldValue,
    selectPlugin,
    create,
  };
}

function correctOptionIndexes(entry: LearningActivity, content: ActivityPresentation): string {
  const correctOptionIds = entry.payload.correctOptionIds;
  if (!Array.isArray(correctOptionIds)) return "";
  return content.options
    .flatMap((option, index) => (correctOptionIds.includes(option.id) ? [String(index + 1)] : []))
    .join(",");
}
