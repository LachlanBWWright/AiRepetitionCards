"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Progress } from "@recall/ui-web/components/progress";
import { Button, Input, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { NativeSelect } from "@recall/ui-web/components/native-select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
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
  type StudyMaterial,
} from "@recall/application";
import { createObjectiveId, type KnowledgeArea } from "@recall/domain";
import { extractStudyMaterial, MAX_STUDY_FILE_BYTES } from "@recall/infra-study-materials";
import { extractStudyMaterialWithOcr, type StudyOcrProgress } from "@/lib/study-material-ocr";
import { tutorApi } from "@/lib/tutor-api";

type Failure = { readonly message: string; readonly notebook?: KnowledgeNotebook | null };
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
  const claimCoverage = Either.isRight(claimResult) ? claimResult.right : [];
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
        title: `Notes · section ${index + 1}`,
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
                section.title + (section.text.length > 12000 ? ` · part ${index + 1}` : "")
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
          if (stopRequested.current || next.session.requestsUsed >= next.session.maxRequests) break;
          const currentClaims = yield* deriveStudyClaimCoverage(next);
          const planned = (next.coveragePlans?.length ?? 0) > 0;
          const rank = { high: 0, medium: 1, low: 2 };
          const claim = currentClaims
            .filter(
              (item) =>
                item.decision === "selected" &&
                item.status === "uncovered" &&
                next.materials?.some(
                  (material) =>
                    material.id === item.materialId &&
                    material.sections.some(
                      (section) => section.id === item.sectionId && section.selected,
                    ),
                ),
            )
            .sort((left, right) => rank[left.priority] - rank[right.priority])[0];
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
  return (
    <section className="flex flex-col gap-4" aria-label="Study materials">
      <h3 className="text-base font-semibold">Study materials</h3>
      <Collapsible className="border-b py-4" open={materials.length === 0}>
        <CollapsibleTrigger className="w-full text-left font-medium">
          1. Add material
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Label>
            Material name
            <Input
              disabled={disabled}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>
          <Label>
            Paste study text
            <Textarea
              disabled={disabled}
              value={text}
              maxLength={500000}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste lecture notes, a chapter, or code examples…"
            />
          </Label>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !text.trim()}
            onClick={paste}
          >
            Save pasted material
          </Button>
          <Label>
            Import documents or images
            <input
              type="file"
              accept=".txt,.md,.markdown,.docx,.pdf,.png,.jpg,.jpeg,.webp"
              disabled={disabled || importing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importFile(file);
                event.target.value = "";
              }}
            />
          </Label>
          <Collapsible>
            <CollapsibleTrigger className="w-full text-left font-medium">
              Scanned PDFs and import help
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Label>
                <Checkbox
                  checked={ocrScans}
                  disabled={disabled || importing}
                  onCheckedChange={(checked) => setOcrScans(checked === true)}
                />
                Read scanned PDF pages (up to 30)
              </Label>
              <p>
                Supports TXT, Markdown, DOCX, PDF, PNG, JPEG and WebP. Scanned text recognition is
                English only. Check spelling, tables, formulas and code after import. Files are read
                on this device.
              </p>
            </CollapsibleContent>
          </Collapsible>
          {importing && (
            <>
              <Alert role="status">
                <AlertDescription>
                  {ocrProgress
                    ? `Reading page ${String(ocrProgress.page)} of ${String(ocrProgress.pages)} · ${String(Math.round(ocrProgress.progress * 100))}%`
                    : "Extracting document text locally…"}
                </AlertDescription>
              </Alert>
              {ocrProgress && (
                <Progress
                  value={Math.max(0, Math.min(100, Math.round(ocrProgress.progress * 100)))}
                  aria-label={`Reading page ${String(ocrProgress.page)} of ${String(ocrProgress.pages)}`}
                />
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => importController.current?.abort()}
              >
                Cancel import
              </Button>
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
      {materials.length > 0 && (
        <h4 className="text-sm font-semibold">2. Check text · 3. Choose topics</h4>
      )}
      {materials.map((material) => (
        <article
          key={material.id}
          tabIndex={-1}
          data-search-target={`material:${material.id}`}
          className="border-b py-3"
        >
          <h4 className="text-sm font-semibold">{material.name}</h4>
          {material.warnings.map((warning, index) => (
            <Alert key={index} role="status">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              run(removeNotebookMaterial(notebook, material.id).pipe(Effect.flatMap(save)))
            }
          >
            Remove material
          </Button>
          {material.sections.map((section) => {
            const progress = coverage.find(
              (item) => item.materialId === material.id && item.sectionId === section.id,
            );
            const hasProposals = notebook.proposals.some((proposal) =>
              proposal.sourceReferences?.some(
                (reference) =>
                  reference.materialId === material.id && reference.sectionId === section.id,
              ),
            );
            return (
              <Collapsible
                key={section.id}
                id={`study-source-${section.id}`}
                tabIndex={-1}
                data-search-target={`passage:${section.id}`}
                open={materials.length === 1 && material.sections.length === 1}
              >
                <CollapsibleTrigger className="w-full text-left font-medium">
                  {section.title}
                  {section.pageNumber ? ` · page ${section.pageNumber}` : ""} ·{" "}
                  {progress?.status ?? "unprocessed"} · {progress?.approvedCards ?? 0} approved
                  cards
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Label>
                    <Checkbox
                      checked={section.selected}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        update({
                          ...material,
                          sections: material.sections.map((item) =>
                            item.id === section.id ? { ...item, selected: checked === true } : item,
                          ),
                        })
                      }
                    />
                    Include this section
                  </Label>
                  <Label>
                    Check extracted text
                    <Textarea
                      value={passageDrafts[section.id] ?? section.text}
                      maxLength={12000}
                      readOnly={hasProposals}
                      disabled={disabled}
                      onChange={(event) =>
                        setPassageDrafts((previous) => ({
                          ...previous,
                          [section.id]: event.target.value,
                        }))
                      }
                    />
                  </Label>
                  {!hasProposals && passageDrafts[section.id] !== undefined && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={disabled || !passageDrafts[section.id]?.trim()}
                      onClick={() => {
                        const value = passageDrafts[section.id];
                        if (value?.trim())
                          run(
                            updateNotebookMaterial(notebook, {
                              ...material,
                              sections: material.sections.map((item) =>
                                item.id === section.id ? { ...item, text: value } : item,
                              ),
                            }).pipe(Effect.flatMap(save)),
                            () =>
                              setPassageDrafts((previous) => {
                                const next = { ...previous };
                                delete next[section.id];
                                return next;
                              }),
                          );
                      }}
                    >
                      Save corrected passage
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      disabled ||
                      networkDisabled ||
                      Object.keys(passageDrafts).length > 0 ||
                      !goal.trim() ||
                      (notebook.coveragePlans ?? []).some(
                        (plan) => plan.materialId === material.id && plan.sectionId === section.id,
                      )
                    }
                    onClick={() => plan(material.id, section.id)}
                  >
                    Suggest topics
                  </Button>
                  {(notebook.coveragePlans ?? [])
                    .filter(
                      (plan) => plan.materialId === material.id && plan.sectionId === section.id,
                    )
                    .map((plan) => (
                      <div key={plan.id}>
                        <h4 className="text-sm font-semibold">Choose topics</h4>
                        {plan.claims.map((claim) => {
                          const progress = claimCoverage.find((item) => item.claimId === claim.id);
                          return (
                            <article
                              key={claim.id}
                              tabIndex={-1}
                              data-search-target={`claim:${claim.id}`}
                              className="border-b py-3"
                            >
                              <strong>{claim.title}</strong>
                              <p>{claim.description}</p>
                              <p>
                                {progress?.status ?? "pending"} · {progress?.pendingCards ?? 0}{" "}
                                pending · {progress?.approvedCards ?? 0} approved
                              </p>
                              <Collapsible>
                                <CollapsibleTrigger className="w-full text-left font-medium">
                                  Source passages
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  {claim.sourceReferences.map((reference, index) => (
                                    <blockquote key={index}>{reference.quote}</blockquote>
                                  ))}
                                </CollapsibleContent>
                              </Collapsible>
                              <Label>
                                Include topic
                                <NativeSelect
                                  disabled={disabled}
                                  value={claim.decision}
                                  onChange={(event) => {
                                    const decision = event.target.value;
                                    if (
                                      decision === "pending" ||
                                      decision === "selected" ||
                                      decision === "skipped"
                                    )
                                      run(
                                        updateStudyCoverageClaim(notebook, {
                                          planId: plan.id,
                                          claimId: claim.id,
                                          decision,
                                          priority: claim.priority,
                                        }).pipe(Effect.flatMap(save)),
                                      );
                                  }}
                                >
                                  <option value="pending">Review later</option>
                                  <option value="selected">Include</option>
                                  <option value="skipped">Skip</option>
                                </NativeSelect>
                              </Label>
                              <Label>
                                Priority
                                <NativeSelect
                                  disabled={disabled}
                                  value={claim.priority}
                                  onChange={(event) => {
                                    const priority = event.target.value;
                                    if (
                                      priority === "high" ||
                                      priority === "medium" ||
                                      priority === "low"
                                    )
                                      run(
                                        updateStudyCoverageClaim(notebook, {
                                          planId: plan.id,
                                          claimId: claim.id,
                                          decision: claim.decision,
                                          priority,
                                        }).pipe(Effect.flatMap(save)),
                                      );
                                  }}
                                >
                                  <option value="high">High</option>
                                  <option value="medium">Medium</option>
                                  <option value="low">Low</option>
                                </NativeSelect>
                              </Label>
                            </article>
                          );
                        })}
                      </div>
                    ))}
                  {hasProposals && (
                    <p>
                      This passage is preserved because cards cite it. Import corrected text as a
                      new source.
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </article>
      ))}
      {materials.length > 0 && (
        <div className="border-b py-4">
          <h4 className="text-sm font-semibold">4. Generate cards</h4>
          <Label>
            Study goal
            <Textarea
              disabled={disabled}
              value={goal}
              maxLength={2000}
              onChange={(event) => setGoal(event.target.value)}
            />
          </Label>
          <Label>
            Depth
            <NativeSelect
              disabled={disabled}
              value={depth}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "overview" || value === "standard" || value === "detailed")
                  setDepth(value);
              }}
            >
              <option value="overview">Overview · central ideas</option>
              <option value="standard">Standard · explanations and distinctions</option>
              <option value="detailed">Detailed · application and edge cases</option>
            </NativeSelect>
          </Label>
          <Label>
            Link cards to concept
            <NativeSelect
              disabled={disabled}
              value={conceptId}
              onChange={(event) => setConceptId(event.target.value)}
            >
              {notebook.concepts.map((concept) => (
                <option key={concept.id} value={concept.id}>
                  {concept.title}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            Maximum cards
            <Input
              type="number"
              min={1}
              max={100}
              value={count}
              disabled={disabled}
              onChange={(event) => setCount(event.target.value)}
            />
          </Label>
          <p>
            {selected.length} sections selected. Selected passages are sent to your AI provider.
          </p>
          <Collapsible>
            <CollapsibleTrigger className="w-full text-left font-medium">
              Generation and usage
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p>
                Each attempt uses one AI request. Suggestions are saved as they arrive. Selected
                topics without cards are generated first, in priority order.
              </p>
            </CollapsibleContent>
          </Collapsible>
          <Button
            type="button"
            variant="default"
            disabled={
              disabled ||
              networkDisabled ||
              !selected.length ||
              !goal.trim() ||
              ((notebook.coveragePlans?.length ?? 0) > 0 &&
                !claimCoverage.some(
                  (claim) =>
                    claim.decision === "selected" &&
                    claim.status === "uncovered" &&
                    selected.some(
                      (source) =>
                        source.material.id === claim.materialId &&
                        source.section.id === claim.sectionId,
                    ),
                )) ||
              Object.keys(passageDrafts).length > 0
            }
            onClick={generate}
          >
            Generate cards
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stopRequested.current = true;
            }}
          >
            Stop after current request
          </Button>
          {suggestions.map((suggestion) => (
            <article key={suggestion.title}>
              <strong>{suggestion.title}</strong>
              <p>{suggestion.description}</p>
              <Button
                type="button"
                variant="outline"
                disabled={
                  disabled ||
                  notebook.concepts.some(
                    (concept) => concept.title.toLowerCase() === suggestion.title.toLowerCase(),
                  )
                }
                onClick={() =>
                  run(
                    addNotebookConcepts(notebook, [
                      {
                        id: createObjectiveId(crypto.randomUUID()),
                        title: suggestion.title,
                        description: suggestion.description,
                        parentId: null,
                        prerequisiteIds: [],
                        objectiveId: null,
                      },
                    ]).pipe(Effect.flatMap(save)),
                  )
                }
              >
                Add concept
              </Button>
            </article>
          ))}
        </div>
      )}
      {notice && (
        <Alert variant="destructive">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
