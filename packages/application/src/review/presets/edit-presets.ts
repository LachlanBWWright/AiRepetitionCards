import { Effect, Schema } from "effect";
import {
  SchedulerSettingsSchema,
  type SchedulerPolicy,
  type SchedulerSettings,
} from "@recall/domain";
import { presetPolicy } from "./preset-policy";
import { validateStudySettings } from "./validate-settings";
export function unusedStudyId(
  prefix: string,
  existing: readonly { readonly id: string }[],
): string {
  return `${prefix}-${String(Array.from({ length: 101 }, (_, index) => index + 1).find((index) => !existing.some((item) => item.id === `${prefix}-${String(index)}`)) ?? 101)}`;
}
export function createStudyPreset(settings: SchedulerSettings, name: string) {
  const id = unusedStudyId("preset", settings.presets ?? []);
  if (!name.trim() || name.trim().length > 80 || (settings.presets?.length ?? 0) >= 100)
    return Effect.fail({
      message: "Use a preset name of 1–80 characters and at most 100 presets.",
    });
  const next = {
    ...settings,
    presets: [
      ...(settings.presets ?? []),
      { id, name: name.trim(), settings: presetPolicy(settings) },
    ],
  };
  return Schema.decodeUnknown(SchedulerSettingsSchema)(next).pipe(
    Effect.mapError(() => ({
      message: "Check the current settings before copying them into a preset.",
    })),
    Effect.flatMap(() => validateStudySettings(next)),
    Effect.as({ settings: next, id }),
  );
}
export function updateStudyPresetPolicy(
  settings: SchedulerSettings,
  id: string,
  policy: SchedulerPolicy,
): SchedulerSettings {
  return {
    ...settings,
    presets: settings.presets?.map((preset) =>
      preset.id === id ? { ...preset, settings: presetPolicy(policy) } : preset,
    ),
  };
}
export function assignStudyGroup(
  settings: SchedulerSettings,
  areaId: string,
  field: "areaParents" | "areaPresets",
  value: string | undefined,
): SchedulerSettings {
  return {
    ...settings,
    [field]: {
      ...Object.fromEntries(
        Object.entries(settings[field] ?? {}).filter(([key]) => key !== areaId),
      ),
      ...(value === undefined ? {} : { [areaId]: value }),
    },
  };
}
export function removeStudyPreset(settings: SchedulerSettings, id: string) {
  const next = { ...settings, presets: settings.presets?.filter((preset) => preset.id !== id) };
  return validateStudySettings(next).pipe(Effect.as(next));
}
