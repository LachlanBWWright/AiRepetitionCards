import { replaceCardFields } from "../review/search/card-browser";
import { rateFilteredCard } from "../review/search/rate-filtered-card";
import { undoReview } from "../review/administration/undo-review";
import { Effect } from "effect";
import type { Workspace } from "@recall/domain";
import type { WorkspaceAuthoringCommand, WorkspaceAuthoringResult } from "./workspace-authoring";
import {
  authoringFailure,
  failure,
  type WorkspaceAuthoringFailure,
} from "./workspace-authoring-validation";
import { updateSchedulerSettings } from "../review/scheduler-settings";
import { administerCards } from "../review/administration/manual-scheduling";
export function applyStudyAuthoring(
  workspace: Workspace,
  command: Extract<
    WorkspaceAuthoringCommand,
    {
      readonly kind:
        | "update-scheduler-settings"
        | "administer-cards"
        | "undo-review"
        | "rate-filtered-card"
        | "replace-card-fields"
        | "resolve-study-settings";
    }
  >,
  now: Date,
): Effect.Effect<WorkspaceAuthoringResult, WorkspaceAuthoringFailure> {
  if (command.kind === "resolve-study-settings") {
    const conflict = workspace.studySettingsConflict;
    if (!conflict)
      return Effect.fail(
        failure("invalid-input", "There is no study settings conflict to resolve."),
      );
    const current = { ...workspace };
    delete current.studySettingsConflict;
    return updateSchedulerSettings(current, conflict[command.choice]).pipe(
      Effect.mapError(authoringFailure),
      Effect.map((next) => ({
        workspace: next,
        message: "Study settings conflict resolved. Sync again to save your choice.",
      })),
    );
  }
  if (command.kind === "replace-card-fields")
    return replaceCardFields(workspace, command, now).pipe(
      Effect.mapError((error) => failure("invalid-input", error.message)),
      Effect.map((next) => ({
        workspace: next,
        message: "Card fields updated. Previous content is retained in version history.",
      })),
    );
  if (command.kind === "rate-filtered-card")
    return rateFilteredCard(workspace, command, now).pipe(
      Effect.mapError((error) => failure("invalid-input", error.message)),
      Effect.map((next) => ({ workspace: next, message: "Filtered review saved." })),
    );
  if (command.kind === "undo-review")
    return undoReview(workspace, command, now).pipe(
      Effect.mapError((error) => failure("invalid-input", error.message)),
      Effect.map((next) => ({
        workspace: next,
        message: "Review undone. The original answer remains in history.",
      })),
    );
  if (command.kind === "update-scheduler-settings")
    return updateSchedulerSettings(workspace, command.settings, now).pipe(
      Effect.mapError(authoringFailure),
      Effect.map((next) => ({ workspace: next, message: "Review settings saved." })),
    );
  return administerCards(workspace, command, now).pipe(
    Effect.mapError((error) => failure("invalid-input", error.message)),
    Effect.map((next) => ({
      workspace: next,
      selectedAreaId: command.areaId,
      message: "Scheduling updated. Answer history is preserved.",
    })),
  );
}
