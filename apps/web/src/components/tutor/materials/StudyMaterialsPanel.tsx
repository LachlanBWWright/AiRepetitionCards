"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  addNotebookConcepts,
  createCardAssistanceTutor,
  deriveStudyClaimCoverage,
  updateStudyCoverageClaim,
  addNotebookMaterial,
  updateNotebookMaterial,
  createStudyMaterialsTutor,
  deriveStudyMaterialCoverage,
  removeNotebookMaterial,
  selectNextStudyMaterialSection,
  type KnowledgeNotebook,
  type StudyCoverageClaim,
  type StudyMaterial,
} from "@recall/application";
import { createObjectiveId, type KnowledgeArea } from "@recall/domain";
import { extractStudyMaterial, MAX_STUDY_FILE_BYTES } from "@recall/infra-study-materials";
import { extractStudyMaterialWithOcr, type StudyOcrProgress } from "@/lib/study-material-ocr";
import { tutorApi } from "@/lib/tutor-api";
import { StudyMaterialsPanelGeneration } from "./StudyMaterialsPanelGeneration";
import { StudyMaterialsPanelPaste } from "./StudyMaterialsPanelPaste";
import { StudyMaterialsPanelSources } from "./StudyMaterialsPanelSources";
import { chooseNextCoverageClaim } from "./studyMaterialsCoverageSelection";

type Failure = { readonly message: string; readonly notebook?: KnowledgeNotebook | null };
type ClaimCoverageStatus = "pending" | "skipped" | "uncovered" | "proposed" | "covered";
type ClaimCoverageWithStatus = { readonly status: ClaimCoverageStatus };
function hasKnownClaimCoverageStatus<T extends { readonly status: string }>(
  claim: T,
): claim is T & ClaimCoverageWithStatus {
  return (
    claim.status === "pending" ||
    claim.status === "skipped" ||
    claim.status === "uncovered" ||
    claim.status === "proposed" ||
    claim.status === "covered"
  );
}
export type StudyMaterialsPanelProps = {
  readonly notebook: KnowledgeNotebook;
  readonly knowledgeArea: KnowledgeArea;
  readonly api?: typeof tutorApi;
  readonly disabled?: boolean;
  readonly networkDisabled?: boolean;
  readonly save: (notebook: KnowledgeNotebook) => Effect.Effect<KnowledgeNotebook, Failure>;
  readonly run: (
    operation: Effect.Effect<KnowledgeNotebook, Failure>,
    success?: () => void,
  ) => void;
  readonly clock?: () => number;
};
function chunks(text: string): readonly string[] {
  const result: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + 12000, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    const value = text.slice(offset, end).trim();
    if (value) result.push(value);
    offset = end;
  }
  return result;
}

function withoutPassageDraft(
  drafts: Readonly<Record<string, string>>,
  sectionId: string,
): Readonly<Record<string, string>> {
  const remainingDrafts = Object.entries(drafts).filter(([id]) => id !== sectionId);
  return Object.fromEntries(remainingDrafts);
}

export function StudyMaterialsPanel({
  notebook,
  knowledgeArea,
  api = tutorApi,
  disabled = false,
  networkDisabled = false,
  save,
  run,
  clock = Date.now,
}: StudyMaterialsPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [goal, setGoal] = useState(notebook.goal);
  const [depth, setDepth] = useState<"overview" | "standard" | "detailed">("standard");
  const [count, setCount] = useState("5");
  const [conceptId, setConceptId] = useState(String(notebook.concepts[0]?.id ?? ""));
  const [suggestions, setSuggestions] = useState<
    readonly { readonly title: string; readonly description: string }[]
  >([]);
  const [importing, setImporting] = useState(false);
  const [passageDrafts, setPassageDrafts] = useState<Readonly<Record<string, string>>>({});
  const [ocrScans, setOcrScans] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<StudyOcrProgress | null>(null);
  const importController = useRef<AbortController | null>(null);
  useEffect(() => () => importController.current?.abort(), []);
  const importPending = useRef(false);
  const stopRequested = useRef(false);
  const materials = notebook.materials ?? [];
  const coverageResult = Effect.runSync(Effect.either(deriveStudyMaterialCoverage(notebook)));
  const coverage = Either.isRight(coverageResult) ? coverageResult.right : [];
  const claimResult = Effect.runSync(Effect.either(deriveStudyClaimCoverage(notebook)));
  const claimCoverage = Either.isRight(claimResult)
    ? claimResult.right.filter(hasKnownClaimCoverageStatus)
    : [];
  const selected = materials.flatMap((material) =>
    material.sections
      .filter((section) => section.selected)
      .map((section) => ({ material, section })),
  );

  function paste() {
    const material: StudyMaterial = {
      id: crypto.randomUUID(),
      name: name.trim() || "Pasted study notes",
      format: "paste",
      importedAt: clock(),
      sections: chunks(text).map((value, index) => ({
        id: crypto.randomUUID(),
        title: `Notes · section ${String(index + 1)}`,
        pageNumber: null,
        text: value,
        selected: true,
      })),
      warnings: [],
    };
    run(addNotebookMaterial(notebook, material).pipe(Effect.flatMap(save)), () => {
      setText("");
      setName("");
    });
  }
  function importFile(file: File) {
    if (importPending.current) return;
    if (file.size > MAX_STUDY_FILE_BYTES) {
      setNotice("Choose a document of at most 16 MiB or paste selected sections.");
      return;
    }
    importPending.current = true;
    setImporting(true);
    setNotice(null);
    setOcrProgress(null);
    const controller = new AbortController();
    importController.current = controller;
    const useOcr =
      /\.(png|jpe?g|webp)$/iu.test(file.name) ||
      (ocrScans && file.name.toLowerCase().endsWith(".pdf"));
    run(
      Effect.gen(function* () {
        const bytes = yield* Effect.tryPromise({
          try: () => file.arrayBuffer(),
          catch: () => ({
            message: "This file could not be read. Try another file or paste its text.",
          }),
        });
        const extracted = yield* useOcr
          ? extractStudyMaterialWithOcr(file.name, new Uint8Array(bytes), {
              signal: controller.signal,
              onProgress: setOcrProgress,
            })
          : extractStudyMaterial(file.name, new Uint8Array(bytes));
        if (controller.signal.aborted)
          return yield* Effect.fail({ message: "Import canceled. No material was saved." });
        const material: StudyMaterial = {
          id: crypto.randomUUID(),
          name: file.name.slice(0, 200),
          format: extracted.format,
          importedAt: clock(),
          warnings: extracted.warnings,
          sections: extracted.sections.flatMap((section) =>
            chunks(section.text).map((value, index) => ({
              id: crypto.randomUUID(),
              title: (
                section.title + (section.text.length > 12000 ? ` · part ${String(index + 1)}` : "")
              ).slice(0, 200),
              pageNumber: section.pageNumber,
              text: value,
              selected: true,
            })),
          ),
        };
        return yield* addNotebookMaterial(notebook, material).pipe(Effect.flatMap(save));
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            importPending.current = false;
            setImporting(false);
            importController.current = null;
            setOcrProgress(null);
          }),
        ),
      ),
    );
  }
  function update(material: StudyMaterial) {
    run(updateNotebookMaterial(notebook, material).pipe(Effect.flatMap(save)));
  }
  function updateClaim(
    planId: string,
    claim: StudyCoverageClaim,
    decision: StudyCoverageClaim["decision"],
    priority: StudyCoverageClaim["priority"],
  ) {
    run(
      updateStudyCoverageClaim(notebook, {
        planId,
        claimId: claim.id,
        decision,
        priority,
      }).pipe(Effect.flatMap(save)),
    );
  }
  function plan(materialId: string, sectionId: string) {
    const tutor = createCardAssistanceTutor(api, (next) => save(next).pipe(Effect.asVoid));
    run(
      tutor
        .plan(
          notebook,
          { knowledgeArea, history: [] },
          {
            materialId,
            sectionId,
            depth,
            goal,
            planId: crypto.randomUUID(),
            claimIds: Array.from({ length: 20 }, () => crypto.randomUUID()),
          },
          clock(),
        )
        .pipe(Effect.flatMap(save)),
    );
  }
  function generate() {
    const requested = Number(count);
    if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
      setNotice("Choose between 1 and 100 card requests for this batch.");
      return;
    }
    const target = notebook.concepts.find((concept) => concept.id === conceptId);
    if (!target || !selected.length) return;
    stopRequested.current = false;
    const tutor = createStudyMaterialsTutor(api, (next) => save(next).pipe(Effect.asVoid));
    run(
      Effect.gen(function* () {
        let next = notebook;
        for (let index = 0; index < requested; index += 1) {
          if (stopRequested.current) break;
          const currentClaims = yield* deriveStudyClaimCoverage(next);
          const planned = (next.coveragePlans?.length ?? 0) > 0;
          const claim = chooseNextCoverageClaim(currentClaims, next);
          const material = claim
            ? next.materials?.find((item) => item.id === claim.materialId)
            : undefined;
          const section = material?.sections.find((item) => item.id === claim?.sectionId);
          const source =
            claim && material && section
              ? { material, section }
              : planned
                ? null
                : selectNextStudyMaterialSection(next);
          if (!source) break;
          const result = yield* tutor.generate(
            next,
            { knowledgeArea, history: [] },
            {
              materialId: source.material.id,
              sectionId: source.section.id,
              conceptId: target.id,
              depth,
              goal,
              ...(claim ? { claimId: claim.claimId } : {}),
            },
            clock(),
            knowledgeArea.cards,
          );
          next = yield* save(result.notebook);
          setSuggestions(result.conceptSuggestions);
        }
        return next;
      }),
    );
  }
  function addSuggestion(suggestion: { readonly title: string; readonly description: string }) {
    const concept = {
      id: createObjectiveId(crypto.randomUUID()),
      title: suggestion.title,
      description: suggestion.description,
      parentId: null,
      prerequisiteIds: [],
      objectiveId: null,
    };
    run(addNotebookConcepts(notebook, [concept]).pipe(Effect.flatMap(save)));
  }
  return (
    <section className="space-y-6" aria-label="Study materials">
      <header className="space-y-2">
        <h3 className="text-xl font-semibold tracking-tight">Study materials</h3>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Paste your notes or import a document to create source-backed cards.
        </p>
      </header>
      <StudyMaterialsPanelPaste
        disabled={disabled}
        name={name}
        text={text}
        onNameChange={setName}
        onTextChange={setText}
        onPaste={paste}
        fileInput={fileInput}
        importing={importing}
        ocrScans={ocrScans}
        onOcrScansChange={setOcrScans}
        ocrProgress={ocrProgress}
        onFileSelected={importFile}
        onCancelImport={() => importController.current?.abort()}
      />
      <StudyMaterialsPanelSources
        notebook={notebook}
        coverage={coverage}
        claimCoverage={claimCoverage}
        disabled={disabled}
        networkDisabled={networkDisabled}
        goal={goal}
        passageDrafts={passageDrafts}
        onPassageDraftChange={(sectionId, value) => {
          setPassageDrafts((previous) => ({ ...previous, [sectionId]: value }));
        }}
        onMaterialUpdate={update}
        onMaterialRemove={(materialId) => {
          run(removeNotebookMaterial(notebook, materialId).pipe(Effect.flatMap(save)));
        }}
        onPassageSave={(material, sectionId, value) => {
          run(
            updateNotebookMaterial(notebook, {
              ...material,
              sections: material.sections.map((item) =>
                item.id === sectionId ? { ...item, text: value } : item,
              ),
            }).pipe(Effect.flatMap(save)),
            () => {
              setPassageDrafts((previous) => withoutPassageDraft(previous, sectionId));
            },
          );
        }}
        onPlan={plan}
        onClaimChange={updateClaim}
      />
      {materials.length > 0 && (
        <StudyMaterialsPanelGeneration
          notebook={notebook}
          disabled={disabled}
          networkDisabled={networkDisabled}
          goal={goal}
          onGoalChange={setGoal}
          depth={depth}
          onDepthChange={setDepth}
          conceptId={conceptId}
          onConceptChange={setConceptId}
          count={count}
          onCountChange={setCount}
          selectedCount={selected.length}
          claimCoverage={claimCoverage}
          passageDraftsExist={Object.keys(passageDrafts).length > 0}
          suggestions={suggestions}
          onGenerate={generate}
          onStop={() => {
            stopRequested.current = true;
          }}
          onAddSuggestion={addSuggestion}
        />
      )}
      {notice && (
        <Alert variant="destructive">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
