"use client";
import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import type { NoteType, ObjectiveId, StudyNote, Workspace } from "@recall/domain";
import {
  BASIC_NOTE_TYPE,
  CLOZE_NOTE_TYPE,
  REVERSED_NOTE_TYPE,
  parseTagInput,
  previewStudyNote,
  workspaceAuthoringBaseline,
  prepareNoteSave,
  noteDraftKey,
  validateNoteAttachment,
  resolveNoteSource,
  collectNoteArea,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import type { NoteAuthoringProps } from "./note-authoring-ports";
import { useNoteLifecycle } from "./use-note-lifecycle";
import { useNoteDraftRetention } from "./use-note-draft-retention";

const builtins = [BASIC_NOTE_TYPE, REVERSED_NOTE_TYPE, CLOZE_NOTE_TYPE];
function emptyNote(type: NoteType, id: string, previous?: StudyNote): StudyNote {
  return {
    id,
    typeId: type.id,
    fields: Object.fromEntries(
      type.fields.map((field) => [
        field.name,
        field.sticky ? (previous?.fields[field.name] ?? "") : "",
      ]),
    ),
    tags: previous?.tags ?? [],
    objectiveIds: previous?.objectiveIds ?? [],
  };
}
export function useNoteAuthoring(props: NoteAuthoringProps) {
  const [location, setLocation] = useState({ areaId: props.area.id, noteId: props.initialNoteId });
  const selected = props.workspace.areas.find((area) => area.id === location.areaId) ?? props.area;
  const source = resolveNoteSource(props.workspace, selected, location.noteId);
  return useResolvedNoteAuthoring(
    { ...props, area: collectNoteArea(props.workspace, source.area), initialNoteId: source.noteId },
    (areaId, noteId) => {
      setLocation({ areaId, noteId });
    },
  );
}
function useResolvedNoteAuthoring(
  { workspace, area, save, createId, initialNoteId, draftPort }: NoteAuthoringProps,
  selectSource: (areaId: NoteAuthoringProps["area"]["id"], noteId: string) => void,
) {
  const restored = draftPort?.drafts.find(
    (draft) => draft.key === noteDraftKey(area.id, initialNoteId),
  );
  const types = [
    ...builtins.filter((type) => !area.noteLibrary?.types.some((item) => item.id === type.id)),
    ...(area.noteLibrary?.types ?? []),
  ];
  const existing = area.noteLibrary?.notes.find((note) => note.id === initialNoteId);
  const initialType =
    restored?.type ?? types.find((type) => type.id === existing?.typeId) ?? BASIC_NOTE_TYPE;
  const [type, setTypeState] = useState<NoteType>(initialType);
  const [note, setNoteState] = useState<StudyNote>(
    () => restored?.note ?? existing ?? emptyNote(initialType, createId()),
  );
  const [tagsText, setTagsTextState] = useState(
    restored?.tagsText ?? existing?.tags.join(", ") ?? "",
  );
  const [snapshot, setSnapshot] = useState<Workspace | undefined>(workspace);
  const [baselineOverride, setBaselineOverride] = useState(restored?.baseline);
  const [dirty, setDirty] = useState(false);
  const [assets, setAssets] = useState<readonly StoredMediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmedTypeChange, setConfirmedTypeChange] = useState(false);
  const active = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const originalType = area.noteLibrary?.types.find((item) => item.id === type.id);
  const affectsOthers = Boolean(
    originalType &&
    JSON.stringify(type) !== JSON.stringify(originalType) &&
    area.noteLibrary?.notes.some((item) => item.typeId === type.id && item.id !== note.id),
  );
  const preview = Effect.runSync(Effect.either(previewStudyNote(type, note)));
  function setType(value: NoteType) {
    setDirty(true);
    setSnapshot((current) => current ?? workspace);
    setConfirmedTypeChange(false);
    setTypeState(value);
  }
  function setNote(value: StudyNote) {
    setDirty(true);
    setSnapshot((current) => current ?? workspace);
    setNoteState(value);
  }
  const lifecycle = useNoteLifecycle({
    workspace,
    area,
    type,
    note,
    setType,
    setNote,
    restored: restored?.migration,
  });
  function setTagsText(value: string) {
    setDirty(true);
    setSnapshot((current) => current ?? workspace);
    setTagsTextState(value);
  }
  function selectType(id: string) {
    lifecycle.resetMigration();
    const selected = types.find((item) => item.id === id);
    if (!selected) return;
    setType(selected);
    setNote(emptyNote(selected, createId()));
    setTagsText("");
    setSnapshot(workspace);
    setBaselineOverride(undefined);
    setConfirmedTypeChange(false);
    setMessage("");
  }
  function selectNote(id: string) {
    lifecycle.resetMigration();
    const source = resolveNoteSource(workspace, area, id);
    const selected = source.area.noteLibrary?.notes.find((item) => item.id === source.noteId);
    const selectedType =
      source.area.noteLibrary?.types.find((item) => item.id === selected?.typeId) ??
      types.find((item) => item.id === selected?.typeId);
    if (!selected || !selectedType) return;
    selectSource(source.area.id, selected.id);
    const draft = draftPort?.drafts.find(
      (item) => item.key === noteDraftKey(source.area.id, selected.id),
    );
    lifecycle.resetMigration(draft?.migration);
    setType(draft?.type ?? selectedType);
    setNote(draft?.note ?? selected);
    setTagsText(draft?.tagsText ?? selected.tags.join(", "));
    setSnapshot(workspace);
    setBaselineOverride(draft?.baseline);
    setConfirmedTypeChange(false);
    setMessage("");
  }
  function cloneType() {
    lifecycle.resetMigration();
    const cloned = { ...type, id: createId(), name: `${type.name} copy` };
    setType(cloned);
    setNote({ ...note, id: createId(), typeId: cloned.id });
    setSnapshot(workspace);
    setBaselineOverride(undefined);
    setConfirmedTypeChange(false);
  }
  function updateTemplate(id: string, change: Partial<NoteType["templates"][number]>) {
    setType({
      ...type,
      templates: type.templates.map((template) =>
        template.id === id ? { ...template, ...change } : template,
      ),
    });
  }
  function removeTemplate(id: string) {
    setType({ ...type, templates: type.templates.filter((template) => template.id !== id) });
  }
  const availableImages = [
    ...new Map(
      area.cards
        .flatMap((card) => card.media ?? [])
        .filter((media) => media.mimeType.startsWith("image/"))
        .map((media) => [media.id, media]),
    ).values(),
  ];
  function insertImage(id: string) {
    const media = availableImages.find((item) => item.id === id);
    const field = type.fields[0]?.name;
    if (!media || !field || (note.media?.length ?? 0) >= 20) return;
    const references = note.media?.some((item) => item.id === id)
      ? note.media
      : [...(note.media ?? []), media];
    setNote({
      ...note,
      media: references,
      fields: { ...note.fields, [field]: `${note.fields[field] ?? ""} ![Image](media:${id})` },
    });
  }
  function setSticky(name: string, sticky: boolean) {
    setType({
      ...type,
      fields: type.fields.map((field) => (field.name === name ? { ...field, sticky } : field)),
    });
  }
  function updateField(name: string, value: string) {
    setNote({ ...note, fields: { ...note.fields, [name]: value } });
  }
  function addTemplate() {
    setType({
      ...type,
      templates: [
        ...type.templates,
        {
          id: createId(),
          name: "New card",
          front: `{{${type.fields[0]?.name ?? "Front"}}}`,
          back: `{{${type.fields[1]?.name ?? type.fields[0]?.name ?? "Back"}}}`,
        },
      ],
    });
  }
  function toggleObjective(id: ObjectiveId) {
    setNote({
      ...note,
      objectiveIds: note.objectiveIds.includes(id)
        ? note.objectiveIds.filter((item) => item !== id)
        : [...note.objectiveIds, id],
    });
  }
  function removeAttachment(id: string) {
    setNote({ ...note, media: (note.media ?? []).filter((item) => item.id !== id) });
    setAssets((current) => current.filter((asset) => asset.reference.id !== id));
  }
  function addAttachment(
    pick: Effect.Effect<StoredMediaAsset | null, { readonly message: string }>,
  ) {
    if (active.current || (note.media?.length ?? 0) >= 20) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    void Effect.runPromise(
      Effect.either(
        pick.pipe(
          Effect.flatMap((asset) => (asset ? validateNoteAttachment(asset) : Effect.succeed(null))),
        ),
      ),
    ).then((result) => {
      active.current = false;
      if (!alive.current) return;
      setBusy(false);
      if (Either.isLeft(result)) {
        setMessage(result.left.message);
        return;
      }
      const asset = result.right;
      if (!asset || note.media?.some((item) => item.id === asset.reference.id)) return;
      setAssets((current) => [...current, asset]);
      setNote({ ...note, media: [...(note.media ?? []), asset.reference] });
    });
  }
  const savedNote = area.noteLibrary?.notes.some((item) => item.id === note.id);
  const draftKey = noteDraftKey(area.id, savedNote ? note.id : undefined);
  const baseline =
    baselineOverride ??
    workspaceAuthoringBaseline(snapshot ?? workspace, {
      kind: "save-note",
      areaId: area.id,
      type,
      note,
      cardIds: [],
    });
  useNoteDraftRetention(
    draftPort,
    {
      key: draftKey,
      areaId: area.id,
      type,
      note,
      tagsText,
      ...(baseline ? { baseline } : {}),
      ...(lifecycle.migration ? { migration: lifecycle.migration } : {}),
    },
    assets,
    dirty,
  );
  function saveNote(another: boolean) {
    if (
      active.current ||
      (affectsOthers && !confirmedTypeChange) ||
      (lifecycle.ownershipConflicts.length > 0 && !lifecycle.migration?.confirmLinkedSnapshots) ||
      Either.isLeft(lifecycle.lifecyclePlan) ||
      (lifecycle.lifecyclePlan.right.requiresConfirmation && !lifecycle.migration?.confirmRemoval)
    )
      return;
    const tags = parseTagInput(tagsText);
    if (Either.isLeft(tags)) {
      setMessage(tags.left.message);
      return;
    }
    const currentNote = { ...note, tags: tags.right };
    active.current = true;
    setBusy(true);
    setMessage("");
    const operation = prepareNoteSave(area, type, currentNote, createId, lifecycle.migration).pipe(
      Effect.flatMap((command) => save(command, baseline, assets)),
    );
    void Effect.runPromise(Effect.either(operation)).then((result) => {
      active.current = false;
      if (!alive.current) return;
      setBusy(false);
      if (Either.isLeft(result)) {
        setMessage(result.left.message);
        return;
      }
      lifecycle.resetMigration();
      setMessage("Note and linked cards saved.");
      setDirty(false);
      setAssets([]);
      draftPort?.discard(draftKey);
      setBaselineOverride(undefined);
      setSnapshot(undefined);
      setConfirmedTypeChange(false);
      if (another) setNoteState(emptyNote(type, createId(), currentNote));
    });
  }
  return {
    ...lifecycle,
    area,
    availableAreas: workspace.areas,
    types,
    type,
    note,
    setType,
    setNote,
    tagsText,
    setTagsText,
    busy,
    message,
    preview,
    affectsOthers,
    confirmedTypeChange,
    setConfirmedTypeChange,
    selectType,
    selectNote,
    cloneType,
    addTemplate,
    updateTemplate,
    removeTemplate,
    updateField,
    setSticky,
    availableImages,
    insertImage,
    saveNote,
    addAttachment,
    removeAttachment,
    toggleObjective,
  };
}
export type NoteAuthoringModel = ReturnType<typeof useNoteAuthoring>;
