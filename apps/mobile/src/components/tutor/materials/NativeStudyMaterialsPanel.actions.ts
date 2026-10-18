import type { KnowledgeArea } from "@recall/domain";
import {
  addNotebookMaterial,
  createCardAssistanceTutor,
  deriveStudyClaimCoverage,
  deriveStudyMaterialCoverage,
  seedKnowledgeNotebook,
  updateNotebookMaterial,
  updateStudyCoverageClaim,
  type KnowledgeNotebook,
  type StudyMaterial,
} from "@recall/application";
import { Effect, Either } from "effect";
import type { NativeStudyMaterialsExtraction } from "./NativeStudyMaterialsPanel.intake";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";

type TutorApi = ReturnType<typeof makeNativeTutorApi>;
type SetState<T> = (value: T | ((current: T) => T)) => void;

export function createNativeStudyMaterialsPanelActions({
  notebook,
  material,
  section,
  area,
  api,
  goal,
  depth,
  createId,
  save,
  runAction,
  persistBeforeRequest,
  hasUnsavedPassage,
  passageDraft,
  setNotice,
  setSelectedId,
  setSectionId,
  setPreview,
  setPassageDraft,
}: {
  readonly notebook: KnowledgeNotebook | null;
  readonly material: StudyMaterial | undefined;
  readonly section: StudyMaterial["sections"][number] | undefined;
  readonly area: KnowledgeArea;
  readonly api: TutorApi | null;
  readonly goal: string;
  readonly depth: "overview" | "standard" | "detailed";
  readonly createId: () => string;
  readonly save: (next: KnowledgeNotebook) => Promise<boolean>;
  readonly runAction: (operation: (isCurrent: () => boolean) => Promise<void>) => Promise<void>;
  readonly persistBeforeRequest: (
    next: unknown,
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly hasUnsavedPassage: boolean;
  readonly passageDraft: { readonly sectionId: string; readonly text: string } | null;
  readonly setNotice: (notice: string) => void;
  readonly setSelectedId: (id: string | null) => void;
  readonly setSectionId: (id: string | null) => void;
  readonly setPreview: SetState<{
    readonly name: string;
    readonly extraction: NativeStudyMaterialsExtraction;
  } | null>;
  readonly setPassageDraft: SetState<{ readonly sectionId: string; readonly text: string } | null>;
}) {
  async function planSection() {
    if (!notebook || !material || !section || !api || hasUnsavedPassage) return;
    await runAction(async (isCurrent) => {
      const result = await Effect.runPromise(
        Effect.either(
          createCardAssistanceTutor(api, persistBeforeRequest).plan(
            notebook,
            { knowledgeArea: area, history: [] },
            {
              materialId: material.id,
              sectionId: section.id,
              depth,
              planId: createId(),
              claimIds: Array.from({ length: 20 }, () => createId()),
            },
            Date.now(),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else if (await save(result.right)) {
        setNotice("Review the suggested claims. Select priorities before generating their cards.");
      }
    });
  }

  async function changeClaim(
    planId: string,
    claimId: string,
    decision: "pending" | "selected" | "skipped",
    priority: "high" | "medium" | "low",
  ) {
    if (!notebook) return;
    await runAction(async (isCurrent) => {
      const result = Effect.runSync(
        Effect.either(updateStudyCoverageClaim(notebook, { planId, claimId, decision, priority })),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) setNotice(result.left.message);
      else await save(result.right);
    });
  }

  async function importPreview(
    preview: { readonly name: string; readonly extraction: NativeStudyMaterialsExtraction } | null,
  ) {
    if (!preview) return;
    await runAction(async (isCurrent) => {
      const base = notebook
        ? Either.right(notebook)
        : Effect.runSync(Effect.either(seedKnowledgeNotebook(area, goal.trim() || area.title)));
      if (Either.isLeft(base)) {
        setNotice(base.left.message);
        return;
      }
      const imported = {
        id: createId(),
        name: preview.name.trim().slice(0, 200),
        format: preview.extraction.format,
        importedAt: Date.now(),
        warnings: preview.extraction.warnings,
        sections: preview.extraction.sections.map((item) => ({
          ...item,
          id: createId(),
          selected: true,
        })),
      };
      const result = Effect.runSync(Effect.either(addNotebookMaterial(base.right, imported)));
      if (!isCurrent()) return;
      if (Either.isLeft(result)) setNotice(result.left.message);
      else if (await save(result.right)) {
        setSelectedId(imported.id);
        setSectionId(null);
        setPreview(null);
        setNotice("Material added.");
      }
    });
  }

  async function updateMaterial(next: StudyMaterial) {
    if (!notebook) return;
    await runAction(async (isCurrent) => {
      const result = Effect.runSync(Effect.either(updateNotebookMaterial(notebook, next)));
      if (!isCurrent()) return;
      if (Either.isLeft(result)) setNotice(result.left.message);
      else if (await save(result.right)) {
        const corrected = next.sections.find((item) => item.id === passageDraft?.sectionId);
        if (corrected?.text === passageDraft?.text) setPassageDraft(null);
        setNotice("Source selection or correction saved.");
      }
    });
  }

  return { planSection, changeClaim, importPreview, updateMaterial };
}

export function getNativeStudyMaterialCoverage(notebook: KnowledgeNotebook | null) {
  const coverageResult = notebook
    ? Effect.runSync(Effect.either(deriveStudyMaterialCoverage(notebook)))
    : null;
  const coverage = coverageResult && Either.isRight(coverageResult) ? coverageResult.right : [];
  const claimCoverageResult = notebook
    ? Effect.runSync(Effect.either(deriveStudyClaimCoverage(notebook)))
    : null;
  const claimCoverage =
    claimCoverageResult && Either.isRight(claimCoverageResult) ? claimCoverageResult.right : [];
  return { coverage, claimCoverage };
}
