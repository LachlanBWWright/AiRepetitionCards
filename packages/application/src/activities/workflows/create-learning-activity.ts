import { Effect, Schema } from "effect";
import {
  addLearningActivity,
  authorLearningActivity,
  reviseLearningActivity,
  validateLearningActivity,
  type ActivityRegistry,
} from "../learning-activities";
import type { ActivityLibrary, LearningActivity } from "@recall/domain";

type CreateLearningActivityOptions = {
  readonly areaId: string;
  readonly title: string;
  readonly pluginId: string;
  readonly objectiveId: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly editing: LearningActivity | null;
  readonly editorDraftId: string | null;
  readonly createId: () => string;
  readonly builtinIds: ReadonlySet<string>;
  readonly authorFields: readonly {
    readonly key: string;
    readonly initial: string;
  }[];
  readonly registry: ActivityRegistry;
  readonly library: ActivityLibrary;
  readonly run: <A>(
    operation: Effect.Effect<A, { readonly message: string }>,
    success: (value: A) => Promise<void> | void,
  ) => Promise<void>;
  readonly persist: (next: ActivityLibrary) => Promise<boolean>;
  readonly isAlive: () => boolean;
  readonly setCreating: (value: boolean) => void;
  readonly setTitle: (value: string) => void;
  readonly setFields: (value: Readonly<Record<string, string>>) => void;
  readonly setMessage: (value: string) => void;
  readonly creationIdentity: {
    current: { readonly id: string; readonly fingerprint: string } | null;
  };
};

export function createLearningActivity(options: CreateLearningActivityOptions): void {
  const {
    areaId,
    title,
    pluginId,
    objectiveId,
    fields,
    editing,
    editorDraftId,
    createId,
    builtinIds,
    authorFields,
    registry,
    library,
    run,
    persist,
    isAlive,
    setCreating,
    setTitle,
    setFields,
    setMessage,
    creationIdentity,
  } = options;
  const fingerprint = JSON.stringify({ areaId, title, pluginId, objectiveId, fields });
  const id =
    editing?.id ??
    editorDraftId ??
    (creationIdentity.current?.fingerprint === fingerprint
      ? creationIdentity.current.id
      : createId());
  creationIdentity.current = { id, fingerprint };
  const fieldValue = (key: string) =>
    fields[key] ?? authorFields.find((field) => field.key === key)?.initial ?? "";
  const operation = (
    builtinIds.has(pluginId)
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
                pluginVersion: getPluginVersion(registry, pluginId, editing),
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
                (value) => value !== editing.objectiveIds[0] && value !== objectiveId,
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
      editorDrafts: (next.editorDrafts ?? []).filter((draft) => draft.id !== editorDraftId),
    })),
  );

  void run(operation, async (next) => {
    const saved = await persist(next);
    if (!isAlive()) return;
    if (saved) {
      setCreating(false);
      setTitle("");
      setFields({});
      setMessage("Activity saved.");
    } else {
      setMessage(
        "Save not confirmed. Your activity is retained here; retry saving before leaving.",
      );
    }
  });
}

function getPluginVersion(
  registry: ActivityRegistry,
  pluginId: string,
  editing: LearningActivity | null,
): number {
  if (editing) return editing.pluginVersion;
  return registry
    .filter((plugin) => plugin.id === pluginId)
    .reduce((latest, plugin) => Math.max(latest, plugin.version), 1);
}
