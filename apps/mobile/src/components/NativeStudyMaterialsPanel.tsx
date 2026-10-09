import { NativeButton } from "./ui/NativeButton";
import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { createObjectiveId, type KnowledgeArea } from "@recall/domain";
import {
  addNotebookMaterial,
  addNotebookConcepts,
  createStudyMaterialsTutor,
  createCardAssistanceTutor,
  deriveStudyClaimCoverage,
  updateStudyCoverageClaim,
  deriveStudyMaterialCoverage,
  selectNextStudyMaterialSection,
  removeNotebookMaterial,
  seedKnowledgeNotebook,
  updateNotebookMaterial,
  type KnowledgeNotebook,
  type WorkspaceSearchTarget,
  type StudyMaterial,
} from "@recall/application";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";
import { extractNativeOcr } from "../storage/native-study-material-ocr";
import { pickNativeStudyFile } from "../storage/native-study-material-files";
import {
  extractNativeStudyFile,
  extractNativeStudyPaste,
} from "../storage/native-study-material-extraction";

type TutorApi = ReturnType<typeof makeNativeTutorApi>;
type Extraction = {
  readonly format: StudyMaterial["format"];
  readonly sections: readonly {
    readonly title: string;
    readonly pageNumber: number | null;
    readonly text: string;
  }[];
  readonly warnings: readonly string[];
};

export function NativeStudyMaterialsPanel({
  notebook,
  searchTarget,
  area,
  api,
  goal,
  createId,
  disabled,
  save,
  persistBeforeRequest,
  runAction,
}: {
  readonly notebook: KnowledgeNotebook | null;
  readonly searchTarget?: WorkspaceSearchTarget | undefined;
  readonly area: KnowledgeArea;
  readonly api: TutorApi | null;
  readonly goal: string;
  readonly createId: () => string;
  readonly disabled: boolean;
  readonly save: (next: KnowledgeNotebook) => Promise<boolean>;
  readonly persistBeforeRequest: (
    next: unknown,
  ) => Effect.Effect<void, { readonly message: string }>;
  readonly runAction: (operation: (isCurrent: () => boolean) => Promise<void>) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showOcr, setShowOcr] = useState(false);
  const [showPassage, setShowPassage] = useState(false);
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const [showGenerationSettings, setShowGenerationSettings] = useState(false);
  const [paste, setPaste] = useState("");
  const [name, setName] = useState("Study notes");
  const [preview, setPreview] = useState<{
    readonly name: string;
    readonly extraction: Extraction;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [passageDraft, setPassageDraft] = useState<{
    readonly sectionId: string;
    readonly text: string;
  } | null>(null);
  const [targetClaimId, setTargetClaimId] = useState<string | null>(null);
  const [count, setCount] = useState("10");
  const [ocrFirst, setOcrFirst] = useState("1");
  const [ocrLast, setOcrLast] = useState("1");
  const [depth, setDepth] = useState<"overview" | "standard" | "detailed">("standard");
  const [suggestions, setSuggestions] = useState<
    readonly { readonly title: string; readonly description: string }[]
  >([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const pause = useRef(false);
  useEffect(
    () => () => {
      pause.current = true;
    },
    [],
  );
  useEffect(() => {
    if (
      !searchTarget ||
      (searchTarget.kind !== "material" &&
        searchTarget.kind !== "passage" &&
        searchTarget.kind !== "claim")
    )
      return;
    const frame = requestAnimationFrame(() => {
      setSelectedId(searchTarget.materialId);
      if (searchTarget.kind === "passage" || searchTarget.kind === "claim") {
        setSectionId(searchTarget.sectionId);
        setShowPassage(true);
      }
      if (searchTarget.kind === "claim") setExpandedClaimId(searchTarget.claimId);
    });
    return () => cancelAnimationFrame(frame);
  }, [searchTarget]);
  const searchedMaterial =
    searchTarget &&
    (searchTarget.kind === "material" ||
      searchTarget.kind === "passage" ||
      searchTarget.kind === "claim")
      ? notebook?.materials?.find((item) => item.id === searchTarget.materialId)
      : null;
  const searchedPassage =
    searchTarget && (searchTarget.kind === "passage" || searchTarget.kind === "claim")
      ? searchedMaterial?.sections.find((item) => item.id === searchTarget.sectionId)
      : null;
  const searchedClaim =
    searchTarget?.kind === "claim"
      ? notebook?.coveragePlans
          ?.flatMap((item) => item.claims)
          .find((item) => item.id === searchTarget.claimId)
      : null;
  const material =
    notebook?.materials?.find((item) => item.id === selectedId) ?? notebook?.materials?.[0];
  const section = material?.sections.find((item) => item.id === sectionId) ?? material?.sections[0];
  const editedText =
    passageDraft?.sectionId === section?.id ? (passageDraft?.text ?? "") : (section?.text ?? "");
  const hasUnsavedPassage =
    passageDraft !== null &&
    notebook?.materials?.some((item) =>
      item.sections.some(
        (source) => source.id === passageDraft.sectionId && source.text !== passageDraft.text,
      ),
    );
  const coverageResult = notebook
    ? Effect.runSync(Effect.either(deriveStudyMaterialCoverage(notebook)))
    : null;
  const coverage = coverageResult && Either.isRight(coverageResult) ? coverageResult.right : [];

  const claimCoverageResult = notebook
    ? Effect.runSync(Effect.either(deriveStudyClaimCoverage(notebook)))
    : null;
  const claimCoverage =
    claimCoverageResult && Either.isRight(claimCoverageResult) ? claimCoverageResult.right : [];
  const plans = notebook?.coveragePlans?.filter((plan) => plan.materialId === material?.id) ?? [];

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

  async function importPreview() {
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
        setPaste("");
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

  async function generate() {
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
      setNotice("Start or continue a notebook session first to set its request budget.");
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
            ? current.coveragePlans
                ?.flatMap((plan) =>
                  plan.materialId === material.id
                    ? plan.claims.map((claim) => ({ plan, claim }))
                    : [],
                )
                .find(
                  (entry) =>
                    entry.claim.id === targetClaimId && entry.claim.decision === "selected",
                )
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
                  all.findIndex(
                    (other) => other.title.toLowerCase() === item.title.toLowerCase(),
                  ) === index,
              )
              .slice(0, 100),
          );
          if (!(await save(current))) return;
          completed += 1;
          setNotice(
            `${completed} proposals saved. Review and approve them below before they become cards.`,
          );
        }
        if (isCurrent())
          setNotice(
            `${completed} proposals saved${pause.current ? " · batch paused" : ""}. Continue with another batch or review proposals below.`,
          );
      } finally {
        if (isCurrent()) setGenerating(false);
      }
    });
  }

  const button = (label: string, action: () => void, blocked = disabled) => (
    <NativeButton
      key={label}
      label={label}
      onPress={action}
      disabled={blocked}
      className={"py-[10px] px-[4px]"}
      labelClassName="text-recall-surface text-[12px] font-bold"
    />
  );
  return (
    <View className={"gap-[12px] py-[12px]"} testID="native-study-materials">
      <Text className={"text-recall-ink text-[14px] font-bold"}>Study materials</Text>
      {searchedMaterial ? (
        <View accessibilityLiveRegion="polite" className={"gap-[8px]"}>
          <Text className={"text-recall-ink text-[14px] font-bold"}>{searchedMaterial.name}</Text>
          {searchedPassage ? (
            <>
              <Text className={"text-recall-ink text-[12px] leading-[18px]"}>
                {searchedPassage.title}
              </Text>
              <Text className={"text-recall-ink text-[12px] leading-[18px]"}>
                {searchedPassage.text}
              </Text>
            </>
          ) : null}
          {searchedClaim ? (
            <Text className={"text-recall-ink text-[12px] leading-[18px]"}>
              {searchedClaim.title}
            </Text>
          ) : null}
        </View>
      ) : null}
      {button(showAdd ? "Close import" : "Add material", () => setShowAdd((current) => !current))}
      <View className={showAdd || !notebook?.materials?.length ? "gap-[10px]" : "hidden"}>
        <Text className={"text-recall-ink text-[14px] font-bold"}>Add material</Text>
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>Name</Text>
        <TextInput
          accessibilityLabel="Material name"
          value={name}
          onChangeText={setName}
          maxLength={200}
          className={"p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"}
        />
        <TextInput
          accessibilityLabel="Paste study material"
          value={paste}
          onChangeText={setPaste}
          multiline
          maxLength={1000000}
          placeholder="Paste your study notes here"
          className={`${"p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"} ${"min-h-[120px] max-h-[260px]"}`}
        />
        <View className={"flex-row flex-wrap gap-[7px]"}>
          {button(
            "Check pasted text",
            () => {
              const result = Effect.runSync(Effect.either(extractNativeStudyPaste(paste)));
              if (Either.isLeft(result)) setNotice(result.left.message);
              else setPreview({ name, extraction: result.right });
            },
            disabled || !paste.trim(),
          )}
          {button(
            "Upload document",
            () =>
              void runAction(async (isCurrent) => {
                const picked = await Effect.runPromise(Effect.either(pickNativeStudyFile()));
                if (!isCurrent()) return;
                if (Either.isLeft(picked)) {
                  setNotice(picked.left.message);
                  return;
                }
                if (!picked.right) return;
                const result = await Effect.runPromise(
                  Effect.either(extractNativeStudyFile(picked.right.name, picked.right.bytes)),
                );
                if (!isCurrent()) return;
                if (Either.isLeft(result)) setNotice(result.left.message);
                else setPreview({ name: picked.right.name, extraction: result.right });
              }),
          )}
        </View>
        {button(showOcr ? "Close scanned import" : "Scanned PDF or image", () =>
          setShowOcr((current) => !current),
        )}
        <View className={showOcr ? "gap-[10px]" : "hidden"}>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            PDF pages (up to 20). English text recognition.
          </Text>
          <View className={"flex-row flex-wrap gap-[7px]"}>
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>From page</Text>
            <TextInput
              accessibilityLabel="First OCR page"
              value={ocrFirst}
              onChangeText={setOcrFirst}
              keyboardType="number-pad"
              maxLength={6}
              className={"p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"}
            />
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>To page</Text>
            <TextInput
              accessibilityLabel="Last OCR page"
              value={ocrLast}
              onChangeText={setOcrLast}
              keyboardType="number-pad"
              maxLength={6}
              className={"p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"}
            />
            {button(
              "Upload scan",
              () =>
                void runAction(async (isCurrent) => {
                  const first = Number(ocrFirst);
                  const last = Number(ocrLast);
                  if (
                    !Number.isInteger(first) ||
                    !Number.isInteger(last) ||
                    first < 1 ||
                    last < first ||
                    last - first >= 20
                  ) {
                    setNotice("Choose a range of 1–20 pages, starting at page 1 or later.");
                    return;
                  }
                  const picked = await Effect.runPromise(Effect.either(pickNativeStudyFile(true)));
                  if (!isCurrent()) return;
                  if (Either.isLeft(picked)) {
                    setNotice(picked.left.message);
                    return;
                  }
                  if (!picked.right) return;
                  setNotice("Reading text…");
                  const result = await Effect.runPromise(
                    Effect.either(
                      extractNativeOcr(picked.right.name, picked.right.bytes, first, last),
                    ),
                  );
                  if (!isCurrent()) return;
                  if (Either.isLeft(result)) setNotice(result.left.message);
                  else {
                    setPreview({ name: picked.right.name, extraction: result.right });
                    setNotice("Check the recognized text before keeping it.");
                  }
                }),
              disabled,
            )}
          </View>
        </View>
      </View>
      {preview ? (
        <View className={"gap-[8px]"}>
          <Text className={"text-recall-ink text-[14px] font-bold"}>
            Check text · {preview.name}
          </Text>
          {preview.extraction.warnings.map((warning, index) => (
            <Text key={index} className={"text-recall-muted text-[11px] leading-[16px]"}>
              {warning}
            </Text>
          ))}
          <ScrollView className={"max-h-[250px]"}>
            {preview.extraction.sections.map((item, index) => (
              <View key={index}>
                <Text className={"text-recall-ink text-[14px] font-bold"}>
                  {item.title}
                  {item.pageNumber ? ` · page ${item.pageNumber}` : ""}
                </Text>
                <Text selectable className={"text-recall-ink text-[12px] leading-[18px]"}>
                  {item.text}
                </Text>
              </View>
            ))}
          </ScrollView>
          {button("Keep material", () => void importPreview())}
          {button("Cancel", () => setPreview(null))}
        </View>
      ) : null}
      <View className={"gap-[10px]"}>
        {notebook?.materials?.map((item) =>
          button(`${material?.id === item.id ? "✓ " : ""}${item.name}`, () => {
            setSelectedId(item.id);
            setSectionId(null);
          }),
        )}
      </View>
      {material ? (
        <>
          <Text className={"text-recall-ink text-[14px] font-bold"}>{material.name}</Text>
          {material.warnings.map((warning, index) => (
            <Text key={index} className={"text-recall-muted text-[11px] leading-[16px]"}>
              {warning}
            </Text>
          ))}
          {material.sections.map((item) => {
            const progress = coverage.find(
              (entry) => entry.sectionId === item.id && entry.materialId === material.id,
            );
            return (
              <View key={item.id} className={"gap-[5px] border-b border-b-recall-line pb-[8px]"}>
                <Text className={"text-recall-ink text-[12px] leading-[18px]"}>
                  {item.title}
                  {item.pageNumber ? ` · page ${item.pageNumber}` : ""} ·{" "}
                  {progress?.status ?? "unprocessed"} · {progress?.pendingCards ?? 0} pending ·{" "}
                  {progress?.approvedCards ?? 0} approved
                </Text>
                <View className={"flex-row flex-wrap gap-[7px]"}>
                  {button(
                    item.selected ? "✓ Selected" : "Select",
                    () =>
                      void updateMaterial({
                        ...material,
                        sections: material.sections.map((entry) =>
                          entry.id === item.id ? { ...entry, selected: !entry.selected } : entry,
                        ),
                      }),
                  )}
                  {button("Check text", () => {
                    setSectionId(item.id);
                    setShowPassage(true);
                  })}
                </View>
              </View>
            );
          })}
          {showPassage && section ? (
            <>
              <Text className={"text-recall-ink text-[14px] font-bold"}>{section.title}</Text>
              {button("Close text", () => setShowPassage(false))}
              <TextInput
                accessibilityLabel="Correct extracted passage"
                multiline
                value={editedText}
                onChangeText={(text) => setPassageDraft({ sectionId: section.id, text })}
                maxLength={12000}
                className={`${"p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"} ${"min-h-[120px] max-h-[260px]"}`}
              />
              {button(
                "Save passage correction",
                () =>
                  void updateMaterial({
                    ...material,
                    sections: material.sections.map((entry) =>
                      entry.id === section.id ? { ...entry, text: editedText } : entry,
                    ),
                  }),
              )}
            </>
          ) : null}
          <View className={"gap-[8px]"}>
            <Text className={"text-recall-ink text-[14px] font-bold"}>Choose topics</Text>
            {button(
              "Suggest topics for this passage",
              () => void planSection(),
              disabled || !api || hasUnsavedPassage === true || !section,
            )}
            {button("Use all selected passages", () => setTargetClaimId(null))}
            {plans.map((plan) => (
              <View key={plan.id} className={"gap-[5px] border-b border-b-recall-line pb-[8px]"}>
                <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                  Source: {material.sections.find((item) => item.id === plan.sectionId)?.title}
                </Text>
                {plan.claims.map((claim) => {
                  const progress = claimCoverage.find((item) => item.claimId === claim.id);
                  return (
                    <View
                      key={claim.id}
                      className={"gap-[5px] border-b border-b-recall-line pb-[8px]"}
                    >
                      {button(claim.title, () =>
                        setExpandedClaimId((current) => (current === claim.id ? null : claim.id)),
                      )}
                      {expandedClaimId === claim.id ? (
                        <Text className={"text-recall-ink text-[12px] leading-[18px]"}>
                          {claim.description}
                        </Text>
                      ) : null}
                      <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                        {progress?.approvedCards ?? 0} cards · {progress?.pendingCards ?? 0}{" "}
                        suggestions
                      </Text>
                      {expandedClaimId === claim.id
                        ? claim.sourceReferences.map((reference, index) => (
                            <Text
                              key={index}
                              selectable
                              className={"text-recall-muted text-[11px] leading-[16px]"}
                            >
                              {reference.pageNumber ? `Page ${reference.pageNumber}: ` : ""}
                              {reference.quote}
                            </Text>
                          ))
                        : null}
                      <View className={"flex-row flex-wrap gap-[7px]"}>
                        {button(
                          claim.decision === "selected" ? "✓ Selected" : "Select",
                          () => void changeClaim(plan.id, claim.id, "selected", claim.priority),
                        )}
                        {button(
                          claim.decision === "skipped" ? "✓ Skipped" : "Skip",
                          () => void changeClaim(plan.id, claim.id, "skipped", claim.priority),
                        )}
                        {expandedClaimId === claim.id
                          ? (["high", "medium", "low"] as const).map((priority) =>
                              button(
                                `${claim.priority === priority ? "✓ " : ""}${priority}`,
                                () => void changeClaim(plan.id, claim.id, claim.decision, priority),
                              ),
                            )
                          : null}
                        {button(
                          `${targetClaimId === claim.id ? "✓ " : ""}Focus on this topic`,
                          () => setTargetClaimId(claim.id),
                          disabled || claim.decision !== "selected",
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
          {suggestions.map((suggestion) => (
            <View
              key={suggestion.title}
              className={"gap-[5px] border-b border-b-recall-line pb-[8px]"}
            >
              <Text className={"text-recall-ink text-[14px] font-bold"}>
                Suggested concept: {suggestion.title}
              </Text>
              <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                {suggestion.description}
              </Text>
              {button(
                "Add suggested concept",
                () =>
                  void runAction(async (isCurrent) => {
                    if (!notebook) return;
                    const result = Effect.runSync(
                      Effect.either(
                        addNotebookConcepts(notebook, [
                          {
                            id: createObjectiveId(createId()),
                            title: suggestion.title,
                            description: suggestion.description,
                            parentId: null,
                            prerequisiteIds: [],
                          },
                        ]),
                      ),
                    );
                    if (!isCurrent()) return;
                    if (Either.isLeft(result)) setNotice(result.left.message);
                    else if (await save(result.right))
                      setSuggestions((current) =>
                        current.filter((item) => item.title !== suggestion.title),
                      );
                  }),
              )}
            </View>
          ))}
          <Text className={"text-recall-ink text-[14px] font-bold"}>Generate cards</Text>
          {button(showGenerationSettings ? "Hide options" : "Options", () =>
            setShowGenerationSettings((current) => !current),
          )}
          <View className={showGenerationSettings ? "gap-[10px]" : "hidden"}>
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Choose the concept these proposals will investigate.
            </Text>
            <View className={"flex-row flex-wrap gap-[7px]"}>
              {notebook?.concepts.map((concept) =>
                button(
                  `${(conceptId ?? notebook.concepts[0]?.id) === concept.id ? "✓ " : ""}${concept.title}`,
                  () => setConceptId(concept.id),
                ),
              )}
            </View>
            <View className={"flex-row flex-wrap gap-[7px]"}>
              {(["overview", "standard", "detailed"] as const).map((value) =>
                button(`${depth === value ? "✓ " : ""}${value}`, () => setDepth(value)),
              )}
            </View>
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>Number of cards</Text>
            <TextInput
              accessibilityLabel="Cards per material batch"
              value={count}
              onChangeText={setCount}
              keyboardType="number-pad"
              className={"p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"}
            />
          </View>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            Selected text is sent to AI when you generate cards.
          </Text>
          <NativeButton
            label="Generate cards"
            onPress={() => void generate()}
            disabled={disabled || !api || hasUnsavedPassage === true}
            className={"py-[10px] px-[4px]"}
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
          {generating ? (
            <NativeButton
              label="Pause generation"
              onPress={() => {
                pause.current = true;
              }}
              className={"py-[10px] px-[4px]"}
              labelClassName="text-recall-surface text-[12px] font-bold"
            />
          ) : null}
          {!api ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Connect AI in settings to generate cards.
            </Text>
          ) : null}
          {button(
            "Remove material",
            () =>
              void runAction(async (isCurrent) => {
                if (!notebook) return;
                const result = Effect.runSync(
                  Effect.either(removeNotebookMaterial(notebook, material.id)),
                );
                if (!isCurrent()) return;
                if (Either.isLeft(result)) setNotice(result.left.message);
                else await save(result.right);
              }),
          )}
        </>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[11px] leading-[16px]"}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
