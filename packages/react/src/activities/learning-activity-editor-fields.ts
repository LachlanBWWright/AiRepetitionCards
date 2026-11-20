import {
  builtinActivityRegistry,
  interactiveActivityEditorFields,
  type ActivityPresentation,
} from "@recall/application";
import type { LearningActivity } from "@recall/domain";
const learningActivityBuiltinIds = new Set([
  ...builtinActivityRegistry.map((plugin) => plugin.id),
  "recall.lua",
]);
export function learningActivityEditorFields(
  entry: LearningActivity,
  content: ActivityPresentation,
  correct: string,
) {
  return (
    interactiveActivityEditorFields(entry) ??
    (entry.pluginId === "recall.lua"
      ? {
          script: typeof entry.payload.script === "string" ? entry.payload.script : "",
          configuration: JSON.stringify(entry.payload.configuration ?? {}, null, 2),
          seed: typeof entry.payload.seed === "number" ? String(entry.payload.seed) : "0",
          fallback: entry.fallback,
        }
      : learningActivityBuiltinIds.has(entry.pluginId)
        ? {
            prompt: content.prompts.join("\n\n"),
            rubric: content.rubric,
            reference: content.reference,
            options: content.options.map((option) => option.text).join("\n"),
            correct: correct,
            tests: JSON.stringify(entry.payload.tests ?? []),
            language:
              typeof entry.payload.language === "string" ? entry.payload.language : "javascript",
            starterCode:
              typeof entry.payload.starterCode === "string" ? entry.payload.starterCode : "",
            signature: typeof entry.payload.signature === "string" ? entry.payload.signature : "",
            constraints: Array.isArray(entry.payload.constraints)
              ? entry.payload.constraints.join("\n")
              : "",
            hints: Array.isArray(entry.payload.hints) ? entry.payload.hints.join("\n") : "",
            exampleTests: entry.payload.exampleTests
              ? JSON.stringify(entry.payload.exampleTests)
              : "",
            mode: typeof entry.payload.mode === "string" ? entry.payload.mode : "practice",
          }
        : { payload: JSON.stringify(entry.payload, null, 2) })
  );
}
