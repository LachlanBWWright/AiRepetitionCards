import { appUrl, waitForWorkspace } from "./helpers.mjs";
export { readWorkspace } from "./helpers.mjs";

export async function openLibrary(page) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Library$/ })
    .click();
  await page.getByRole("heading", { name: /Library$/ }).waitFor();
}

export async function createArea(page, title = "Go programming") {
  // Exercise the normal legacy-storage migration with an empty validated library.
  // The session marker survives reload so the seed cannot overwrite later saves.
  await page.addInitScript(
    ({ origin, key, marker, workspace }) => {
      if (location.origin !== origin || sessionStorage.getItem(marker) !== null) return;
      localStorage.setItem(key, JSON.stringify(workspace));
      sessionStorage.setItem(marker, "seeded");
    },
    {
      origin: new URL(appUrl).origin,
      key: "recall-workspace-v1",
      marker: "recall-e2e-empty-library-seeded",
      workspace: { schemaVersion: 1, reviews: 0, reviewEvents: [], areas: [] },
    },
  );
  await page.goto(appUrl);
  await waitForWorkspace(page, (workspace) => workspace?.schemaVersion === 1);
  await page.getByRole("button", { name: "Add learning area", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New area", exact: true });
  await dialog.getByLabel("Area name", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Create area", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await openLibrary(page);
}

export async function draftCard(page, front, back) {
  await page
    .getByRole("region", { name: "Your cards", exact: true })
    .getByRole("button", { name: "Add a card", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Add card", exact: true });
  await dialog.getByLabel("Question", { exact: true }).fill(front);
  await dialog.getByLabel("Answer", { exact: true }).fill(back);
  return dialog;
}

export async function addCard(page, front, back) {
  const dialog = await draftCard(page, front, back);
  await dialog.getByRole("button", { name: "Add card", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

export function cardRow(page, front) {
  return page
    .getByRole("region", { name: "Your cards", exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: front, exact: true }) });
}

export function notebookFixture(areaId) {
  const conceptId = "00000000-0000-4000-8000-000000000001";
  const materialId = "00000000-0000-4000-8000-000000000002";
  const sectionId = "00000000-0000-4000-8000-000000000003";
  const evidenceId = "00000000-0000-4000-8000-000000000004";
  return {
    version: 1,
    areaId,
    goal: "Understand goroutine scheduling",
    concepts: [
      {
        id: conceptId,
        title: "Goroutine scheduling",
        description: "Cooperative concurrency",
        parentId: null,
        objectiveId: conceptId,
        prerequisiteIds: [],
      },
    ],
    materials: [
      {
        id: materialId,
        name: "Goroutine lecture notes",
        format: "paste",
        importedAt: 1000,
        warnings: [],
        sections: [
          {
            id: sectionId,
            title: "Goroutine execution",
            pageNumber: null,
            selected: true,
            text: "A goroutine runs concurrently with other goroutines.",
          },
        ],
      },
    ],
    evidence: [
      {
        kind: "tutor",
        id: evidenceId,
        conceptId,
        question: "Does each goroutine need an OS thread?",
        answer: "No, goroutines share OS threads.",
        learnerConfidence: "confident",
        at: 2000,
        linkedCardIds: [],
        evaluation: {
          result: "mastered",
          confidence: 0.9,
          objectiveId: conceptId,
          suggestedAction: "none",
          feedback: "Goroutines are multiplexed.",
          misconception: null,
        },
      },
    ],
    proposals: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        conceptId,
        evidenceIds: [evidenceId],
        createdAt: 3000,
        status: "pending",
        cardId: null,
        proposal: {
          front: "How are goroutines multiplexed?",
          back: "The runtime schedules them onto OS threads.",
          objectiveId: conceptId,
          rationale: "Understand goroutine concurrency.",
        },
      },
    ],
    session: {
      phase: "idle",
      targetConceptId: null,
      pendingQuestion: null,
      mode: "diagnostic",
      askedQuestions: 0,
      maxQuestions: 12,
      maxRequests: 40,
      requestsUsed: 0,
      startedAt: null,
      maximumDurationMs: 1800000,
      skippedConceptIds: [],
    },
  };
}
