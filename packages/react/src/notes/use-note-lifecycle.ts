import { useState } from "react";
import { Effect } from "effect";
import type { LearningArea, NoteType, StudyNote, Workspace } from "@recall/domain";
import {
  noteOwnershipConflicts,
  migrateNoteFields,
  previewNoteMigration,
  type NoteMigration,
} from "@recall/application";

type Props = {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly type: NoteType;
  readonly note: StudyNote;
  readonly setType: (type: NoteType) => void;
  readonly setNote: (note: StudyNote) => void;
  readonly restored?: NoteMigration | undefined;
};
export function useNoteLifecycle({
  workspace,
  area,
  type,
  note,
  setType,
  setNote,
  restored,
}: Props) {
  const [migrationState, setMigration] = useState<NoteMigration | undefined>(restored);
  const ownershipConflicts = noteOwnershipConflicts(workspace, area);
  const contentKey = JSON.stringify({ type, note, ownershipConflicts });
  const [confirmedContent, setConfirmedContent] = useState(
    restored?.confirmRemoval ? contentKey : "",
  );
  const migration = migrationState
    ? {
        ...migrationState,
        confirmRemoval: migrationState.confirmRemoval && confirmedContent === contentKey,
        confirmLinkedSnapshots:
          migrationState.confirmLinkedSnapshots && confirmedContent === contentKey,
      }
    : undefined;
  const saved = area.noteLibrary?.notes.find((item) => item.id === note.id);
  const sourceType = area.noteLibrary?.types.find((item) => item.id === saved?.typeId);
  const plan = Effect.runSync(Effect.either(previewNoteMigration(area, type, note, migration)));
  function changed(fields: NoteMigration["fields"], templates = migration?.templates ?? {}) {
    setMigration(saved ? { fields, templates, confirmRemoval: false } : undefined);
  }
  function renameField(name: string, next: string) {
    if (
      !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(next) ||
      type.fields.some((field) => field.name === next)
    )
      return;
    const replace = (text: string) =>
      text.replace(/\{\{([#^/]?)([^{}]+)\}\}/g, (token: string, prefix: string, field: string) =>
        field === name ? `{{${prefix}${next}}}` : token,
      );
    setType({
      ...type,
      fields: type.fields.map((field) => (field.name === name ? { ...field, name: next } : field)),
      templates: type.templates.map((template) => ({
        ...template,
        front: replace(template.front),
        back: replace(template.back),
        ...(template.clozeField === name ? { clozeField: next } : {}),
      })),
    });
    setNote({
      ...note,
      fields: Object.fromEntries(
        Object.entries(note.fields).map(([key, value]) => [key === name ? next : key, value]),
      ),
    });
    const fields = Object.fromEntries(
      Object.entries(migration?.fields ?? {}).filter(([key]) => key !== name),
    );
    changed({ ...fields, [next]: migration?.fields[name] ?? name });
  }
  function removeField(name: string) {
    if (type.fields.length < 2) return;
    setType({ ...type, fields: type.fields.filter((field) => field.name !== name) });
    setNote({
      ...note,
      fields: Object.fromEntries(Object.entries(note.fields).filter(([key]) => key !== name)),
    });
    changed(
      Object.fromEntries(Object.entries(migration?.fields ?? {}).filter(([key]) => key !== name)),
    );
  }
  function moveField(name: string, offset: number) {
    const index = type.fields.findIndex((field) => field.name === name);
    const target = index + offset;
    const field = type.fields[index];
    if (!field || target < 0 || target >= type.fields.length) return;
    const fields = [...type.fields];
    fields.splice(index, 1);
    fields.splice(target, 0, field);
    setType({ ...type, fields });
  }
  function convertType(selected: NoteType) {
    if (!saved || !sourceType || selected.id === type.id) return;
    const fields = Object.fromEntries(
      selected.fields.map((field, index) => [
        field.name,
        sourceType.fields.some((item) => item.name === field.name)
          ? field.name
          : (sourceType.fields[index]?.name ?? ""),
      ]),
    );
    const templates = Object.fromEntries(
      selected.templates.map((template, index) => [
        template.id,
        sourceType.templates.some((item) => item.id === template.id)
          ? template.id
          : (sourceType.templates[index]?.id ?? ""),
      ]),
    );
    setType(selected);
    setNote(migrateNoteFields(note.typeId === saved.typeId ? note : saved, selected, fields));
    changed(fields, templates);
  }
  function mapField(target: string, source: string) {
    if (!saved) return;
    changed({ ...migration?.fields, [target]: source });
    setNote({ ...note, fields: { ...note.fields, [target]: saved.fields[source] ?? "" } });
  }
  function mapTemplate(target: string, source: string) {
    changed(migration?.fields ?? {}, { ...migration?.templates, [target]: source });
  }
  function confirmRemoval(value: boolean) {
    setConfirmedContent(value ? contentKey : "");
    setMigration({
      fields: migration?.fields ?? {},
      templates: migration?.templates ?? {},
      confirmRemoval: value,
      confirmLinkedSnapshots: migration?.confirmLinkedSnapshots ?? false,
    });
  }
  return {
    migration,
    ownershipConflicts,
    confirmLinkedSnapshots: (value: boolean) => {
      setConfirmedContent(value ? contentKey : "");
      setMigration({
        fields: migration?.fields ?? {},
        templates: migration?.templates ?? {},
        confirmRemoval: migration?.confirmRemoval ?? false,
        confirmLinkedSnapshots: value,
      });
    },
    lifecyclePlan: plan,
    sourceType,
    savedNote: saved,
    renameField,
    removeField,
    moveField,
    convertType,
    mapField,
    mapTemplate,
    confirmRemoval,
    resetMigration: (value?: NoteMigration) => {
      setMigration(value);
      setConfirmedContent("");
    },
  };
}
