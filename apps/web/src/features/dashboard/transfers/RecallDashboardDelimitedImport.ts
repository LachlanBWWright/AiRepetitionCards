import { Effect } from "effect";
import { importDelimitedCards } from "@recall/application";
import type { PendingContentImport } from "@/features/dashboard/layout/RecallDashboardSupport";

export function importDashboardDelimitedFile(
  event: React.ChangeEvent<HTMLInputElement>,
  dependencies: {
    readonly areaCount: number;
    readonly colors: readonly string[];
    readonly beginContentImport: () => boolean;
    readonly failContentImport: (message: string) => void;
    readonly clearContentImportBusy: () => void;
    readonly requestConfirmation: (description: string, onConfirm: () => unknown) => void;
    readonly setImportExportOpen: (open: boolean) => void;
    readonly commitContentImport: (request: PendingContentImport) => Promise<boolean>;
  },
): void {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  if (file.size > 2_000_000) {
    dependencies.failContentImport("CSV and TSV files must be 2 MB or smaller.");
    return;
  }
  if (!dependencies.beginContentImport()) return;
  const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const title = file.name
    .replace(/\.(csv|tsv)$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const program = Effect.tryPromise({
    try: () => file.text(),
    catch: () => ({ _tag: "DelimitedImportReadError" }) as const,
  }).pipe(
    Effect.map((text) =>
      importDelimitedCards(
        text,
        delimiter,
        title,
        dependencies.colors[dependencies.areaCount % dependencies.colors.length] ?? "#c4ed68",
        new Date(),
      ),
    ),
    Effect.match({
      onFailure: () => {
        dependencies.failContentImport("The selected file could not be read.");
      },
      onSuccess: (result) => {
        if (result._tag === "Failure") {
          const messages = {
            "invalid-quote": "The CSV/TSV has invalid quoted fields.",
            "too-many-rows":
              "CSV/TSV imports are limited to 500 card rows plus an optional header.",
            "too-many-columns": "CSV/TSV imports are limited to 30 columns.",
            "field-too-large": "CSV/TSV fields are limited to 1 MB.",
            "input-too-large": "CSV/TSV imports are limited to 2 MB.",
            "missing-front-back":
              "Include front and back columns, or two columns without a header. Every non-empty row needs both a question and an answer; no cards were imported.",
            "no-cards": "No non-empty front/back card rows were found.",
            "too-many-cards": "A Deck can contain up to 500 cards.",
            "too-many-objectives": "A Deck can contain up to 200 learning objectives.",
            "invalid-metadata":
              "Rename the import file to use a title of 80 characters or fewer and select a valid area color.",
            "invalid-content": "The imported content could not be validated as a portable Deck.",
            "invalid-tag-encoding":
              "The tags_json column must contain a JSON array of valid tag text. Correct it before importing.",
            "identity-unavailable": "Card identifiers could not be created. Try importing again.",
            "invalid-timestamp": "The import time is invalid. Try importing again.",
          } as const;
          dependencies.failContentImport(messages[result.reason]);
          return;
        }
        dependencies.clearContentImportBusy();
        dependencies.requestConfirmation(
          `Import ${String(result.area.cards.length)} cards into a new deck named “${result.area.title}”? The file passed validation. Existing decks remain available.`,
          () => {
            if (!dependencies.beginContentImport()) return;
            dependencies.setImportExportOpen(false);
            return dependencies.commitContentImport({
              area: result.area,
              message: `${String(result.area.cards.length)} cards imported from ${file.name}.`,
            });
          },
        );
      },
    }),
  );
  Effect.runFork(program);
}
