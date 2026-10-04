import { Effect } from "effect";
import {
  createLocalBudgetService,
  decodeLocalBudgetRecord,
  localBudgetFailure,
} from "@recall/application";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";

export const browserLocalBudget = createLocalBudgetService((update) =>
  coordinateLocalWrite(
    Effect.gen(function* () {
      const raw = yield* Effect.try({
        try: () => window.localStorage.getItem("recall-local-ai-usage"),
        catch: () => localBudgetFailure(),
      });
      const state = yield* decodeLocalBudgetRecord(raw);
      const result = yield* update(state);
      if (result.state !== state)
        yield* Effect.try({
          try: () =>
            window.localStorage.setItem("recall-local-ai-usage", JSON.stringify(result.state)),
          catch: () => localBudgetFailure(),
        });
      return result.value;
    }),
    () => localBudgetFailure(),
  ),
);
