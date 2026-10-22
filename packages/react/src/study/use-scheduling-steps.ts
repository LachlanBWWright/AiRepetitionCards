"use client";

import { useState } from "react";
import type { SchedulerPolicy } from "@recall/domain";
import { parseLearningSteps } from "@recall/application";
export function useSchedulingSteps(
  policy: SchedulerPolicy,
  onChange: (policy: SchedulerPolicy) => void,
) {
  const [learning, setLearning] = useState((policy.learningSteps ?? [1, 10]).join(" "));
  const [relearning, setRelearning] = useState((policy.relearningSteps ?? [10]).join(" "));
  const updateSteps = (value: string, field: "learningSteps" | "relearningSteps") => {
    if (field === "learningSteps") setLearning(value);
    else setRelearning(value);
    onChange({ ...policy, [field]: parseLearningSteps(value) });
  };
  return { learning, relearning, updateSteps };
}
