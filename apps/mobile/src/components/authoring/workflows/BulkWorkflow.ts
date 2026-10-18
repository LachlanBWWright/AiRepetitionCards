import { Either, Schema } from "effect";
import {
  parseTagInput,
  workspaceAuthoringBaseline,
  WorkspaceAuthoringCommandSchema,
} from "@recall/application";
import type { LearningArea, Workspace } from "@recall/domain";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { NativeWorkspaceBulkAction } from "../library/NativeWorkspaceBulkActions";
import type { RefAccess } from "../RefAccess";

type BulkRequest = { readonly command: unknown; readonly baseline?: string };
type Submit = (command: unknown, baseline?: string) => void;

type BulkWorkflowDependencies = {
  readonly editor: Editor | null;
  readonly area: LearningArea | undefined;
  readonly workspace: Workspace | null;
  readonly locked: boolean;
  readonly action: NativeWorkspaceBulkAction | null;
  readonly tags: string;
  readonly destination: string;
  readonly selectedIds: readonly string[];
  readonly selectionAreaId: string;
  readonly request: BulkRequest | null;
  readonly snapshot: RefAccess<Workspace | null>;
  readonly createId: () => string;
  readonly setAction: Dispatch<SetStateAction<NativeWorkspaceBulkAction | null>>;
  readonly setRequest: Dispatch<SetStateAction<BulkRequest | null>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly bound: (command: unknown) => { readonly baseline?: string };
  readonly submit: Submit;
};

export function createBulkWorkflow(dependencies: BulkWorkflowDependencies) {
  const {
    editor,
    area,
    workspace,
    locked,
    action,
    tags,
    destination,
    selectedIds,
    selectionAreaId,
    request,
    snapshot,
    createId,
    setAction,
    setRequest,
    setMessage,
    bound,
    submit,
  } = dependencies;

  function begin(actionToBegin: NativeWorkspaceBulkAction) {
    if (editor) {
      setMessage("Keep, save, or close the editor before changing selected cards.");
      return;
    }
    setAction(actionToBegin);
    setRequest(null);
    setMessage(null);
    snapshot.set(workspace);
    if (actionToBegin === "delete" && area) {
      const command = { kind: "bulk-delete-cards", areaId: area.id, cardIds: selectedIds };
      setRequest({ command, ...bound(command) });
    }
  }

  function submitBulk() {
    if (!area || !workspace || locked) return;
    if (selectionAreaId !== area.id || selectedIds.length === 0) {
      setMessage(
        "Return to the original deck or cancel this bulk action before starting another selection.",
      );
      return;
    }
    let nextRequest = request;
    if (!nextRequest) {
      let command: unknown;
      if (action === "tags") {
        const parsed = parseTagInput(tags);
        if (Either.isLeft(parsed) || (Either.isRight(parsed) && parsed.right.length === 0)) {
          setMessage(Either.isLeft(parsed) ? parsed.left.message : "Enter at least one tag.");
          return;
        }
        command = {
          kind: "bulk-tag-cards",
          areaId: area.id,
          cardIds: selectedIds,
          tags: parsed.right,
        };
      } else if (action === "move") {
        if (!destination) {
          setMessage("Choose a destination deck.");
          return;
        }
        command = {
          kind: "bulk-move-cards",
          areaId: area.id,
          targetAreaId: destination,
          cards: selectedIds.map((id) => ({ cardId: id, newCardId: createId() })),
        };
      } else {
        return;
      }
      const decoded = Schema.decodeUnknownEither(WorkspaceAuthoringCommandSchema)(command);
      if (Either.isLeft(decoded)) {
        setMessage("The selected action could not be validated.");
        return;
      }
      const previousWorkspace = snapshot.get();
      const baseline = previousWorkspace
        ? workspaceAuthoringBaseline(previousWorkspace, decoded.right)
        : undefined;
      nextRequest = { command: decoded.right, ...(baseline === undefined ? {} : { baseline }) };
      setRequest(nextRequest);
    }
    submit(nextRequest.command, nextRequest.baseline);
  }

  return { begin, submitBulk };
}
