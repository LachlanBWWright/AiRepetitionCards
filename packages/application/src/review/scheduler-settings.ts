import { Effect, Schema } from "effect";
import { SchedulerSettingsSchema, WorkspaceSchema, type Workspace } from "@recall/domain";
import { rescheduleChangedParameters } from "./administration/reschedule-parameters";
import { validateStudySettings } from "./presets/validate-settings";

export type SchedulerSettingsFailure = {
  readonly _tag: "SchedulerSettingsInvalid";
  readonly message: string;
};

/** Validate preferences; an injected save time enables explicitly requested due-date adjustments. */
export const updateSchedulerSettings = (
  workspaceInput: unknown,
  settingsInput: unknown,
  savedAt?: Date,
): Effect.Effect<Workspace, SchedulerSettingsFailure> =>
  Effect.gen(function* () {
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError((): SchedulerSettingsFailure => ({
        _tag: "SchedulerSettingsInvalid",
        message: "Your workspace contains invalid data.",
      })),
    );
    const schedulerSettings = yield* Schema.decodeUnknown(SchedulerSettingsSchema)(
      settingsInput,
    ).pipe(
      Effect.mapError((): SchedulerSettingsFailure => ({
        _tag: "SchedulerSettingsInvalid",
        message:
          "Check retention (70–97%), daily new cards (0–1000), leech threshold (2–100), and fitted parameters.",
      })),
    );
    yield* validateStudySettings(schedulerSettings).pipe(
      Effect.mapError((failure): SchedulerSettingsFailure => ({
        _tag: "SchedulerSettingsInvalid",
        message: failure.message,
      })),
    );
    const next = { ...workspace, schedulerSettings };
    return savedAt
      ? yield* rescheduleChangedParameters(workspace, next, savedAt).pipe(
          Effect.mapError((error): SchedulerSettingsFailure => ({
            _tag: "SchedulerSettingsInvalid",
            message: error.message,
          })),
        )
      : next;
  });
