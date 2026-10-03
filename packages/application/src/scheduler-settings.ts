import { Effect, Schema } from "effect";
import { SchedulerSettingsSchema, WorkspaceSchema, type Workspace } from "@recall/domain";

export type SchedulerSettingsFailure = {
  readonly _tag: "SchedulerSettingsInvalid";
  readonly message: string;
};

/** Save a preference for future reviews without rebuilding schedules or changing history. */
export const updateSchedulerSettings = (
  workspaceInput: unknown,
  settingsInput: unknown,
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
        message: "Choose a target retention between 70% and 97%.",
      })),
    );
    return { ...workspace, schedulerSettings };
  });
