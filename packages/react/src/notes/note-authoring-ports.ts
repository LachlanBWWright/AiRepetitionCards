import type { Effect } from "effect";
import type { StoredMediaAsset } from "@recall/local-store";
import type { LearningArea, Workspace } from "@recall/domain";
import type { NoteAuthoringDraft, WorkspaceAuthoringCommand } from "@recall/application";

export type NoteAuthoringSave = (
  command: WorkspaceAuthoringCommand,
  baseline?: string,
  assets?: readonly StoredMediaAsset[],
) => Effect.Effect<unknown, { readonly message: string }>;
export type NoteDraftPort = {
  readonly drafts: readonly NoteAuthoringDraft[];
  readonly retain: (draft: NoteAuthoringDraft, assets: readonly StoredMediaAsset[]) => void;
  readonly discard: (key: string) => void;
};
export type NoteAuthoringProps = {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly save: NoteAuthoringSave;
  readonly createId: () => string;
  readonly initialNoteId?: string | undefined;
  readonly draftPort?: NoteDraftPort | undefined;
};
