"use client";

import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  addNotebookConcepts,
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
          const source = selectNextStudyMaterialSection(next);
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
    <section className="tutor-gaps" aria-label="Study from materials">
      <p className="eyebrow">STUDY FROM MATERIALS</p>
      <h3>Turn your sources into a growing deck</h3>
      <p>
        Extract and correct text on this device. Only the selected section shown below is sent to
        your AI provider for each request. Original files are not uploaded or retained; extracted
        passages are saved in your private notebook.
      </p>
      <label>
        Material name
        <input
          disabled={disabled}
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Paste study text
        <textarea
          disabled={disabled}
          value={text}
          maxLength={500000}
          onChange={(event) => setText(event.target.value)}
          placeholder="Paste lecture notes, a chapter, or code examples…"
        />
      </label>
      <button
        type="button"
        className="text-button"
        disabled={disabled || !text.trim()}
        onClick={paste}
      >
        Save pasted material
      </button>
      <label>
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
      </label>
      <label>
        <input
          type="checkbox"
          checked={ocrScans}
          disabled={disabled || importing}
          onChange={(event) => setOcrScans(event.target.checked)}
        />
        Use local OCR for scanned PDFs (up to 30 pages)
      </label>
      <p>
        TXT, Markdown, DOCX and PDF, or PNG, JPEG and WebP images. Image OCR uses bundled English
        recognition on this device, without uploads. Enable OCR to read scanned PDF pages, including
        partial text layers. Check spelling, tables, formulas and code before generating cards.
      </p>
      {importing && (
        <>
          <p role="status">
            {ocrProgress
              ? `Reading page ${String(ocrProgress.page)} of ${String(ocrProgress.pages)} · ${String(Math.round(ocrProgress.progress * 100))}%`
              : "Extracting document text locally…"}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() => importController.current?.abort()}
          >
            Cancel import
          </button>
        </>
      )}
      {materials.map((material) => (
        <article key={material.id} className="rounded-xl border border-stone-200 p-3">
          <h4>{material.name}</h4>
          {material.warnings.map((warning, index) => (
            <p key={index} role="status">
              {warning}
            </p>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() =>
              run(removeNotebookMaterial(notebook, material.id).pipe(Effect.flatMap(save)))
            }
          >
            Remove material
          </button>
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
              <details
                key={section.id}
                id={`study-source-${section.id}`}
                open={materials.length === 1 && material.sections.length === 1}
              >
                <summary>
                  {section.title}
                  {section.pageNumber ? ` · page ${section.pageNumber}` : ""} ·{" "}
                  {progress?.status ?? "unprocessed"} · {progress?.approvedCards ?? 0} approved
                  cards
                </summary>
                <label>
                  <input
                    type="checkbox"
                    checked={section.selected}
                    disabled={disabled}
                    onChange={(event) =>
                      update({
                        ...material,
                        sections: material.sections.map((item) =>
                          item.id === section.id
                            ? { ...item, selected: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />
                  Include this section
                </label>
                <label>
                  Extracted passage / exact AI source
                  <textarea
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
                </label>
                {!hasProposals && passageDrafts[section.id] !== undefined && (
                  <button
                    type="button"
                    className="text-button"
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
                  </button>
                )}
                {hasProposals && (
                  <p>
                    This passage is preserved because cards cite it. Import corrected text as a new
                    source.
                  </p>
                )}
              </details>
            );
          })}
        </article>
      ))}
      {materials.length > 0 && (
        <>
          <label>
            Study goal
            <textarea
              disabled={disabled}
              value={goal}
              maxLength={2000}
              onChange={(event) => setGoal(event.target.value)}
            />
          </label>
          <label>
            Depth
            <select
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
            </select>
          </label>
          <label>
            Link cards to concept
            <select
              disabled={disabled}
              value={conceptId}
              onChange={(event) => setConceptId(event.target.value)}
            >
              {notebook.concepts.map((concept) => (
                <option key={concept.id} value={concept.id}>
                  {concept.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Card requests in this batch
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              disabled={disabled}
              onChange={(event) => setCount(event.target.value)}
            />
          </label>
          <p>
            {selected.length} sections selected. Each attempt uses one notebook AI request.
            Completed proposals remain saved if you stop or a later request fails. Duplicate results
            may produce fewer cards. Continue with another batch to expand coverage.
          </p>
          <button
            type="button"
            className="primary-button"
            disabled={
              disabled ||
              networkDisabled ||
              !selected.length ||
              !goal.trim() ||
              Object.keys(passageDrafts).length > 0
            }
            onClick={generate}
          >
            Generate source-backed card proposals
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              stopRequested.current = true;
            }}
          >
            Stop after current request
          </button>
          {suggestions.map((suggestion) => (
            <article key={suggestion.title}>
              <strong>{suggestion.title}</strong>
              <p>{suggestion.description}</p>
              <button
                type="button"
                className="text-button"
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
                Approve suggested concept
              </button>
            </article>
          ))}
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </section>
  );
}
