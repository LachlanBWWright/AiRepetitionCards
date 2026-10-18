import { Effect, Either } from "effect";
import {
  createStudyMaterialsTutor,
  selectNextStudyMaterialSection,
  type KnowledgeNotebook,
  type StudyMaterial,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";

export type GenerationDepth = "overview" | "standard" | "detailed";
type Suggestion = { readonly title: string; readonly description: string };
type TutorApi = ReturnType<typeof makeNativeTutorApi>;

function findSelectedClaim(notebook: KnowledgeNotebook, materialId: string, claimId: string) {
  const plans = notebook.coveragePlans?.filter((plan) => plan.materialId === materialId) ?? [];
  for (const plan of plans) {
    const claim = plan.claims.find(
      (entry) => entry.id === claimId && entry.decision === "selected",
    );
    if (claim) return { plan, claim };
  }
  return undefined;
}

export async function generateNativeStudyMaterialBatch({
  notebook,
  material,
  api,
  area,
  count,
  conceptId,
  depth,
  hasUnsavedPassage,
  targetClaimId,
  pause,
  persistBeforeRequest,
  runAction,
  save,
  setNotice,
  setGenerating,
  setSuggestions,
}: {
  readonly notebook: KnowledgeNotebook | null;
  readonly material: StudyMaterial | undefined;
  readonly api: TutorApi | null;
  readonly area: KnowledgeArea;
  readonly count: string;
  readonly conceptId: string | null;
  readonly depth: GenerationDepth;
  readonly hasUnsavedPassage: boolean;
  readonly targetClaimId: string | null;
  readonly pause: { current: boolean };
  readonly persistBeforeRequest: (
    next: unknown,
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly runAction: (operation: (isCurrent: () => boolean) => Promise<void>) => Promise<void>;
  readonly save: (next: KnowledgeNotebook) => Promise<boolean>;
  readonly setNotice: (notice: string | null) => void;
  readonly setGenerating: (generating: boolean) => void;
  readonly setSuggestions: (
    update: (previous: readonly Suggestion[]) => readonly Suggestion[],
  ) => void;
}) {
  if (!notebook || !material || !api) return;
  if (hasUnsavedPassage) {
    setNotice("Save your passage correction before generating cards.");
    return;
  }
  const wanted = Number(count);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 100) {
    setNotice("Choose 1–100 cards per batch. Additional batches can be generated later.");
    return;
  }
  const sections = material.sections.filter((item) => item.selected);
  if (sections.length === 0 || !notebook.concepts[0]) {
    setNotice("Select a source section and add a notebook concept first.");
    return;
  }
  if (notebook.session.phase !== "active") {
    setNotice("Start or continue practice first.");
    return;
  }
  pause.current = false;
  await runAction(async (isCurrent) => {
    setGenerating(true);
    let current = notebook;
    let completed = 0;
    try {
      const tutor = createStudyMaterialsTutor(api, persistBeforeRequest);
      for (let index = 0; index < wanted && !pause.current && isCurrent(); index += 1) {
        const selectedClaim = targetClaimId
          ? findSelectedClaim(current, material.id, targetClaimId)
          : undefined;
        if (targetClaimId && !selectedClaim) {
          setNotice("Select an approved coverage claim before targeted generation.");
          return;
        }
        const source = selectedClaim
          ? material.sections.find(
              (entry) => entry.id === selectedClaim.plan.sectionId && entry.selected,
            )
          : selectNextStudyMaterialSection(current, material.id)?.section;
        if (!source) break;
        const result = await Effect.runPromise(
          Effect.either(
            tutor.generate(
              current,
              { knowledgeArea: area, history: [] },
              {
                materialId: material.id,
                sectionId: source.id,
                ...(selectedClaim ? { claimId: selectedClaim.claim.id } : {}),
                conceptId: conceptId ?? current.concepts[0]?.id,
                depth,
                goal: current.goal,
              },
              Date.now(),
              area.cards,
            ),
          ),
        );
        if (!isCurrent()) return;
        if (Either.isLeft(result)) {
          if (result.left.notebook) await save(result.left.notebook);
          setNotice(result.left.message);
          return;
        }
        current = result.right.notebook;
        setSuggestions((previous) =>
          [...previous, ...result.right.conceptSuggestions]
            .filter(
              (item, index, all) =>
                all.findIndex((other) => other.title.toLowerCase() === item.title.toLowerCase()) ===
                index,
            )
            .slice(0, 100),
        );
        if (!(await save(current))) return;
        completed += 1;
        setNotice(
          `${String(completed)} proposals saved. Review and approve them below before they become cards.`,
        );
      }
      if (isCurrent()) {
        setNotice(
          `${String(completed)} proposals saved${pause.current ? " · batch paused" : ""}. Continue with another batch or review proposals below.`,
        );
      }
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  });
}
