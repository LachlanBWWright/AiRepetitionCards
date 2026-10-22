"use client";

import { useState } from "react";
import { Effect, Either } from "effect";
import type { SchedulerPolicy, SchedulerSettings } from "@recall/domain";
import {
  createStudyPreset,
  updateStudyPresetPolicy,
  removeStudyPreset,
  renameStudyPreset,
} from "@recall/application";
export function useStudyPresets(
  settings: SchedulerSettings,
  onChange: (settings: SchedulerSettings) => void,
) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const presets = settings.presets ?? [];
  const selected = presets.find((preset) => preset.id === (selectedId || presets[0]?.id));
  const proposal = Effect.runSync(Effect.either(createStudyPreset(settings, name)));
  const create = () => {
    if (Either.isLeft(proposal)) return;
    onChange(proposal.right.settings);
    setSelectedId(proposal.right.id);
    setName("");
  };
  const changePolicy = (policy: SchedulerPolicy) => {
    if (selected) onChange(updateStudyPresetPolicy(settings, selected.id, policy));
  };
  const rename = (name: string) => {
    if (selected) onChange(renameStudyPreset(settings, selected.id, name));
  };
  const deleteSelected = () => {
    if (!selected) return;
    const next = Effect.runSync(Effect.either(removeStudyPreset(settings, selected.id)));
    if (Either.isRight(next)) {
      onChange(next.right);
      setSelectedId("");
    }
  };
  return {
    name,
    setName,
    presets,
    selectedId,
    setSelectedId,
    selected,
    create,
    canCreate: Either.isRight(proposal),
    changePolicy,
    rename,
    deleteSelected,
  };
}
