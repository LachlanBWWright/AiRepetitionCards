"use client";
import { useState } from "react";
import type { AreaId, SchedulerSettings } from "@recall/domain";
import { localStudyDay, todayStudyLimits } from "@recall/application";

export function useTodayStudyLimits(
  settings: SchedulerSettings,
  onChange: (settings: SchedulerSettings) => void,
  clock: () => number,
  areaId?: AreaId,
) {
  const [newLimit, setNewLimit] = useState("");
  const [reviewLimit, setReviewLimit] = useState("");
  const parse = (value: string) => (value.trim() ? Number(value) : undefined);
  const valid = (value: string, maximum: number) => {
    const number = parse(value);
    return number === undefined || (Number.isInteger(number) && number >= 0 && number <= maximum);
  };
  const canApply =
    Boolean(newLimit.trim() || reviewLimit.trim()) &&
    valid(newLimit, 1000) &&
    valid(reviewLimit, 10000);
  const apply = () => {
    if (!canApply) return;
    const dailyNewLimit = parse(newLimit);
    const dailyReviewLimit = parse(reviewLimit);
    onChange(
      todayStudyLimits(
        settings,
        localStudyDay(clock()),
        {
          ...(dailyNewLimit === undefined ? {} : { dailyNewLimit }),
          ...(dailyReviewLimit === undefined ? {} : { dailyReviewLimit }),
        },
        areaId,
      ),
    );
  };
  return { newLimit, setNewLimit, reviewLimit, setReviewLimit, canApply, apply };
}
