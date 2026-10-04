import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { NativeButton } from "@recall/ui-native";
import { designTokens } from "@recall/design-tokens";
import { createObjectiveId, type KnowledgeArea } from "@recall/domain";
import {
  addNotebookMaterial,
  addNotebookConcepts,
  createStudyMaterialsTutor,
  deriveStudyMaterialCoverage,
  selectNextStudyMaterialSection,
  removeNotebookMaterial,
  seedKnowledgeNotebook,
  updateNotebookMaterial,
  type KnowledgeNotebook,
  type StudyMaterial,
} from "@recall/application";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";
import { extractNativeOcr } from "../storage/native-study-material-ocr";
import { pickNativeStudyFile } from "../storage/native-study-material-files";
import {
  extractNativeStudyFile,
  extractNativeStudyPaste,
} from "../storage/native-study-material-extraction";

const palette = designTokens.color;
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
        setNotice(
          "Extracted text saved privately on this device. Original files are not retained in the notebook.",
        );
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
          const source = selectNextStudyMaterialSection(current, material.id)?.section;
          if (!source) break;
          const result = await Effect.runPromise(
            Effect.either(
              tutor.generate(
                current,
                { knowledgeArea: area, history: [] },
                {
                  materialId: material.id,
                  sectionId: source.id,
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
      style={styles.button}
      labelStyle={styles.buttonText}
    />
  );
  return (
    <View style={styles.panel} testID="native-study-materials">
      <Text style={styles.title}>Study from materials</Text>
      <Text style={styles.muted}>
        Paste text or import TXT, Markdown, DOCX or a text PDF. Extraction is local. Only selected
        text is sent to the configured AI when you generate proposals. Use on-device OCR for scanned
        PDFs or PNG/JPEG notes (English and Latin script).
      </Text>
      <TextInput
        accessibilityLabel="Material name"
        value={name}
        onChangeText={setName}
        maxLength={200}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Paste study material"
        value={paste}
        onChangeText={setPaste}
        multiline
        maxLength={1000000}
        placeholder="Paste your study notes here"
        style={[styles.input, styles.editor]}
      />
      <View style={styles.row}>
        {button(
          "Preview pasted text",
          () => {
            const result = Effect.runSync(Effect.either(extractNativeStudyPaste(paste)));
            if (Either.isLeft(result)) setNotice(result.left.message);
            else setPreview({ name, extraction: result.right });
          },
          disabled || !paste.trim(),
        )}
        {button(
          "Choose document",
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
      <Text style={styles.muted}>
        OCR page range (PDF only): 1–20 pages per import. Images use page 1. Recognition stays on
        this device; review and correct its text.
      </Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="First OCR page"
          value={ocrFirst}
          onChangeText={setOcrFirst}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Last OCR page"
          value={ocrLast}
          onChangeText={setOcrLast}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.input}
        />
        {button(
          "Choose scanned PDF or image (OCR)",
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
              setNotice("Recognizing text locally…");
              const result = await Effect.runPromise(
                Effect.either(extractNativeOcr(picked.right.name, picked.right.bytes, first, last)),
              );
              if (!isCurrent()) return;
              if (Either.isLeft(result)) setNotice(result.left.message);
              else {
                setPreview({ name: picked.right.name, extraction: result.right });
                setNotice("Review OCR text before keeping it. Source images are not retained.");
              }
            }),
          disabled,
        )}
      </View>
      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.title}>Review extraction · {preview.name}</Text>
          {preview.extraction.warnings.map((warning, index) => (
            <Text key={index} style={styles.muted}>
              {warning}
            </Text>
          ))}
          <ScrollView style={styles.previewScroll}>
            {preview.extraction.sections.map((item, index) => (
              <View key={index}>
                <Text style={styles.title}>
                  {item.title}
                  {item.pageNumber ? ` · page ${item.pageNumber}` : ""}
                </Text>
                <Text selectable style={styles.text}>
                  {item.text}
                </Text>
              </View>
            ))}
          </ScrollView>
          {button("Keep extracted material", () => void importPreview())}
          {button("Discard extraction", () => setPreview(null))}
        </View>
      ) : null}
      <View style={styles.row}>
        {notebook?.materials?.map((item) =>
          button(`${material?.id === item.id ? "✓ " : ""}${item.name}`, () => {
            setSelectedId(item.id);
            setSectionId(null);
          }),
        )}
      </View>
      {material ? (
        <>
          <Text style={styles.title}>{material.name}</Text>
          {material.warnings.map((warning, index) => (
            <Text key={index} style={styles.muted}>
              {warning}
            </Text>
          ))}
          {material.sections.map((item) => {
            const progress = coverage.find(
              (entry) => entry.sectionId === item.id && entry.materialId === material.id,
            );
            return (
              <View key={item.id} style={styles.section}>
                <Text style={styles.text}>
                  {item.title}
                  {item.pageNumber ? ` · page ${item.pageNumber}` : ""} ·{" "}
                  {progress?.status ?? "unprocessed"} · {progress?.pendingCards ?? 0} pending ·{" "}
                  {progress?.approvedCards ?? 0} approved
                </Text>
                <View style={styles.row}>
                  {button(
                    item.selected ? "Selected for generation" : "Select section",
                    () =>
                      void updateMaterial({
                        ...material,
                        sections: material.sections.map((entry) =>
                          entry.id === item.id ? { ...entry, selected: !entry.selected } : entry,
                        ),
                      }),
                  )}
                  {button("View / correct passage", () => setSectionId(item.id))}
                </View>
              </View>
            );
          })}
          {section ? (
            <>
              <Text style={styles.muted}>
                Source passage · {section.title}. Correct extraction before generating cards. Saved
                references must remain valid.
              </Text>
              <TextInput
                accessibilityLabel="Correct extracted passage"
                multiline
                value={editedText}
                onChangeText={(text) => setPassageDraft({ sectionId: section.id, text })}
                maxLength={12000}
                style={[styles.input, styles.editor]}
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
          {suggestions.map((suggestion) => (
            <View key={suggestion.title} style={styles.section}>
              <Text style={styles.title}>Suggested concept: {suggestion.title}</Text>
              <Text style={styles.muted}>{suggestion.description}</Text>
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
          <Text style={styles.muted}>Choose the concept these proposals will investigate.</Text>
          <View style={styles.row}>
            {notebook?.concepts.map((concept) =>
              button(
                `${(conceptId ?? notebook.concepts[0]?.id) === concept.id ? "✓ " : ""}${concept.title}`,
                () => setConceptId(concept.id),
              ),
            )}
          </View>
          <Text style={styles.muted}>
            Depth changes the instruction to the AI; it does not guarantee complete coverage. Each
            proposal uses one AI request. Saved proposals and source selections survive a pause.
          </Text>
          <View style={styles.row}>
            {(["overview", "standard", "detailed"] as const).map((value) =>
              button(`${depth === value ? "✓ " : ""}${value}`, () => setDepth(value)),
            )}
          </View>
          <TextInput
            accessibilityLabel="Cards per material batch"
            value={count}
            onChangeText={setCount}
            keyboardType="number-pad"
            style={styles.input}
          />
          <NativeButton
            label="Generate selected material cards"
            onPress={() => void generate()}
            disabled={disabled || !api || hasUnsavedPassage === true}
            style={styles.button}
            labelStyle={styles.buttonText}
          />
          {generating ? (
            <NativeButton
              label="Pause after current request"
              onPress={() => {
                pause.current = true;
              }}
              style={styles.button}
              labelStyle={styles.buttonText}
            />
          ) : null}
          {!api ? (
            <Text style={styles.muted}>
              AI is unavailable. Material extraction and your existing notebook work locally.
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
        <Text accessibilityRole="alert" style={styles.muted}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10, padding: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 12 },
  title: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  muted: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  text: { color: palette.ink, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  input: { padding: 10, borderRadius: 8, backgroundColor: palette.paper, color: palette.ink },
  editor: { minHeight: 120, maxHeight: 260, textAlignVertical: "top" },
  button: { padding: 10, backgroundColor: palette.green, borderRadius: 8 },
  buttonText: { color: palette.darkGreen, fontSize: 11, fontWeight: "700" },
  preview: { gap: 8 },
  previewScroll: { maxHeight: 250 },
  section: { gap: 5, borderBottomWidth: 1, borderBottomColor: palette.line, paddingBottom: 8 },
});
