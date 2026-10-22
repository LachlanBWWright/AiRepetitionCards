"use client";
import { useState } from "react";
import { Effect, Either } from "effect";
import type { Workspace } from "@recall/domain";
import { simulateStudyWorkload, type WorkloadSimulation } from "@recall/application";
export function useStudyPlanner(workspace: Workspace, now: number, areaId?: string) {
  const [days, setDays] = useState("30");
  const [retention, setRetention] = useState("90");
  const [newPerDay, setNewPerDay] = useState("10");
  const [reviewLimit, setReviewLimit] = useState("200");
  const [additionalCards, setAdditionalCards] = useState("0");
  const [result, setResult] = useState<WorkloadSimulation | null>(null);
  const [message, setMessage] = useState("");
  const run = () => {
    const simulated = Effect.runSync(
      Effect.either(
        simulateStudyWorkload(
          workspace,
          now,
          {
            days: Number(days),
            retention: Number(retention) / 100,
            newPerDay: Number(newPerDay),
            reviewLimit: Number(reviewLimit),
            additionalCards: Number(additionalCards),
          },
          areaId,
        ),
      ),
    );
    setResult(Either.isRight(simulated) ? simulated.right : null);
    setMessage(
      Either.isLeft(simulated)
        ? simulated.left.message
        : "Scenario calculated. Re-run after changing inputs or study data.",
    );
  };
  return {
    fields: [
      { label: "Days", value: days, set: setDays },
      { label: "Target retention (%)", value: retention, set: setRetention },
      { label: "New cards per day", value: newPerDay, set: setNewPerDay },
      { label: "Reviews per day (including learning)", value: reviewLimit, set: setReviewLimit },
      { label: "Additional new cards", value: additionalCards, set: setAdditionalCards },
    ],
    result,
    message,
    run,
  };
}
