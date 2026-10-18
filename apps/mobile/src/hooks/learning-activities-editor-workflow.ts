import { Effect, Schema } from "effect";
import type { ActivityLibrary, Assessment, LearningActivity } from "@recall/domain";
import {
  activityFromCard,
  addLearningActivity,
  authorLearningActivity,
  decodeActivityLibrary,
  findActivityPlugin,
  presentLearningActivity,
  reviseLearningActivity,
  validateLearningActivity,
  type ActivityAuthoringField,
  type ActivityPresentation,
  type ActivityRegistry,
} from "@recall/application";

type EditorRef<Value> = { current: Value };
type Run = <A>(
  operation: Effect.Effect<A, { readonly message: string }>,
  success: (value: A) => Promise<void> | void,
) => Promise<void>;

function correctOptionIndexes(entry: LearningActivity, optionIds: readonly string[]) {
  const correctOptionIds = entry.payload.correctOptionIds;
  if (!Array.isArray(correctOptionIds)) return "";
  const selectedIds = correctOptionIds.filter(
    (optionId): optionId is string => typeof optionId === "string",
  );
  return optionIds
    .flatMap((optionId, index) => (selectedIds.includes(optionId) ? [String(index + 1)] : []))
    .join(",");
}

function pluginVersionFor(
  pluginId: string,
  registry: ActivityRegistry,
  editing: LearningActivity | null,
) {
  if (editing) return editing.pluginVersion;
  return registry
    .filter((plugin) => plugin.id === pluginId)
    .reduce((latest, plugin) => Math.max(latest, plugin.version), 1);
}

function objectiveIdsForEdit(objectiveId: string, editing: LearningActivity): readonly string[] {
  return [
    objectiveId,
    ...editing.objectiveIds.filter((id) => id !== editing.objectiveIds[0] && id !== objectiveId),
  ];
}

function validatePluginPayload(
  payload: unknown,
  id: string,
  areaId: string,
  title: string,
  pluginId: string,
  objectiveId: string,
  registry: ActivityRegistry,
  editing: LearningActivity | null,
) {
  const normalizedTitle = title.trim();
  return validateLearningActivity(
    {
      id,
      areaId,
      title: normalizedTitle,
      pluginId,
      pluginVersion: pluginVersionFor(pluginId, registry, editing),
      revision: 1,
      objectiveIds: [objectiveId],
      fallback: normalizedTitle,
      payload,
    },
    registry,
  );
}

export function useLearningActivitiesEditorWorkflow({
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
}: {
  readonly areaId: string;
  readonly objectives: readonly { readonly id: string; readonly title: string }[];
  readonly library: ActivityLibrary;
  readonly registry: ActivityRegistry;
  readonly platform: "web" | "native";
  readonly title: string;
  readonly pluginId: string;
  readonly objectiveId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly editing: LearningActivity | null;
  readonly authorFields: readonly ActivityAuthoringField[];
  readonly builtinIds: ReadonlySet<string>;
  readonly createId: () => string;
  readonly persist: (next: ActivityLibrary, synchronized?: boolean) => Promise<boolean>;
  readonly run: Run;
  readonly alive: EditorRef<boolean>;
  readonly editorDraftId: EditorRef<string | null>;
  readonly editorFingerprint: EditorRef<string>;
  readonly creationIdentity: EditorRef<{
    readonly id: string;
    readonly fingerprint: string;
  } | null>;
  readonly setCreating: (value: boolean) => void;
  readonly setEditing: (value: LearningActivity | null) => void;
  readonly setTitle: (value: string) => void;
  readonly setPluginId: (value: string) => void;
  readonly setObjectiveId: (value: string) => void;
  readonly setFields: (value: Readonly<Record<string, string>>) => void;
  readonly setMessage: (value: string | null) => void;
  readonly openAttempt: (entry: LearningActivity, content: ActivityPresentation) => void;
}) {
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
        if (await persist(next, true)) {
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

  function edit(entry: LearningActivity) {
    if (findActivityPlugin(registry, entry)?.capabilities.platforms.includes(platform) !== true) {
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
              correct: correctOptionIndexes(
                entry,
                content.options.map((option) => option.id),
              ),
              tests: JSON.stringify(entry.payload.tests ?? []),
            }
          : { payload: JSON.stringify(entry.payload, null, 2) },
      );
      setCreating(true);
    });
  }

  function fieldValue(key: string) {
    return fields[key] ?? authorFields.find((field) => field.key === key)?.initial ?? "";
  }

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
              validatePluginPayload(
                payload,
                id,
                areaId,
                title,
                pluginId,
                objectiveId,
                registry,
                editing,
              ),
            ),
          )
      ).pipe(
        Effect.map((entry) =>
          editing
            ? {
                ...entry,
                pluginVersion: editing.pluginVersion,
                objectiveIds: objectiveIdsForEdit(objectiveId, editing),
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
          if (!alive.current) return;
          const presented = await Effect.runPromise(
            Effect.either(presentLearningActivity(entry, registry)),
          );
          if (presented._tag === "Right") openAttempt(entry, presented.right);
          else setMessage(presented.left.message);
        } else if (alive.current) setMessage("Card activity save not confirmed; retry.");
      },
    );
  }

  return { closeEditor, newActivity, resumeEditor, edit, fieldValue, create, wrapCard };
}
