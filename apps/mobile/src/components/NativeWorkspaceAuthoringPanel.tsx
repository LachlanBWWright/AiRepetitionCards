import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Schema, Either } from "effect";
import { NativeButton } from "@recall/ui-native";
import { designTokens } from "@recall/design-tokens";
import {
  workspaceAuthoringBaseline,
  isSupportedMediaContent,
  formatTagInput,
  parseTagInput,
  WorkspaceAuthoringCommandSchema,
  type AreaSettings,
  type CardContent,
} from "@recall/application";
import {
  SchedulerSettingsSchema,
  MediaReferenceSchema,
  createObjectiveId,
  type LearningArea,
  type Workspace,
} from "@recall/domain";

import type { StoredMediaAsset } from "@recall/local-store";

type Editor =
  | { readonly kind: "scheduler"; readonly retentionPercent: string; readonly baseline?: string }
  | {
      readonly kind: "area";
      readonly mode: "create" | "edit";
      readonly id: string;
      readonly title: string;
      readonly color: string;
      readonly baseline?: string;
    }
  | {
      readonly kind: "card";
      readonly mode: "create" | "edit";
      readonly areaId: string;
      readonly id: string;
      readonly content: CardContent;
      readonly stagedAssets: readonly StoredMediaAsset[];
      readonly tagsText: string;
      readonly baseline?: string;
    }
  | {
      readonly kind: "settings";
      readonly areaId: string;
      readonly settings: AreaSettings;
      readonly tagsText: string;
      readonly baseline?: string;
    }
  | {
      readonly kind: "delete";
      readonly command: unknown;
      readonly title: string;
      readonly baseline?: string;
    };
export type NativeWorkspaceAuthoringPanelProps = {
  readonly workspace: Workspace | null;
  readonly activeAreaId: string | null;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly createId: () => string;
  readonly onCommand: (
    command: unknown,
    expectedBaseline?: string,
    assets?: readonly StoredMediaAsset[],
  ) => Promise<{ readonly ok: boolean; readonly message: string }>;
  readonly onPickAttachment?: () => Effect.Effect<
    StoredMediaAsset | null,
    { readonly message: string }
  >;
  readonly initialEditor?:
    | "create-area"
    | "edit-area"
    | "edit-card"
    | "basic"
    | "cloze"
    | "settings"
    | "scheduler"
    | "delete-area"
    | "delete-card";
  readonly initialMessage?: string;
  readonly initialObjectiveFilter?: string;
  readonly initialSearch?: string;
};
const palette = designTokens.color;
const settingsFor = (area: LearningArea): AreaSettings => ({
  description: area.description ?? null,
  language: area.language ?? "English",
  tags: area.tags ?? [],
  licence: area.licence ?? null,
  attribution: area.attribution ?? null,
  ai: area.ai ?? {
    tutorInstructions: "",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  objectives: area.objectives ?? [],
});
const emptyContent: CardContent = {
  kind: "basic",
  front: "",
  back: "",
  objectiveIds: [],
  tags: [],
  media: [],
};

export function NativeWorkspaceAuthoringPanel({
  workspace,
  activeAreaId,
  disabled = false,
  disabledReason,
  createId,
  onCommand,
  onPickAttachment,
  initialEditor,
  initialMessage,
  initialObjectiveFilter,
  initialSearch,
}: NativeWorkspaceAuthoringPanelProps) {
  const area = workspace?.areas.find((item) => item.id === activeAreaId) ?? workspace?.areas[0];
  const baseline = (command: unknown) =>
    workspace
      ? (() => {
          const decoded = Schema.decodeUnknownEither(WorkspaceAuthoringCommandSchema)(command);
          return Either.isRight(decoded)
            ? workspaceAuthoringBaseline(workspace, decoded.right)
            : undefined;
        })()
      : undefined;
  const bound = (command: unknown) => {
    const value = baseline(command);
    return value === undefined ? {} : { baseline: value };
  };
  function areaEditor(mode: "create" | "edit"): Editor {
    return {
      kind: "area",
      mode,
      id: mode === "edit" && area ? area.id : createId(),
      title: mode === "edit" ? (area?.title ?? "") : "",
      color: mode === "edit" ? (area?.color ?? "#307f62") : "#307f62",
      ...(mode === "edit" && area
        ? bound({ kind: "save-area", mode, id: area.id, title: area.title, color: area.color })
        : {}),
    };
  }
  function cardEditor(index?: number, kind: "basic" | "cloze" = "basic"): Editor | null {
    if (!area) return null;
    const card = index === undefined ? undefined : area.cards[index];
    return {
      kind: "card",
      mode: card ? "edit" : "create",
      areaId: area.id,
      id: card?.id ?? createId(),
      tagsText: formatTagInput(card?.tags ?? []),
      stagedAssets: [],
      content: card
        ? {
            kind: card.cloze ? "cloze" : "basic",
            front: card.front,
            back: card.back,
            ...(card.cloze ? { cloze: card.cloze } : {}),
            objectiveIds: card.objectiveIds ?? [],
            tags: card.tags ?? [],
            media: card.media ?? [],
          }
        : {
            ...emptyContent,
            kind,
            ...(kind === "cloze" ? { cloze: { text: "", deletionIndex: 1 } } : {}),
          },
      ...(card ? bound({ kind: "delete-card", areaId: area.id, cardId: card.id }) : {}),
    };
  }
  function deleteEditor(cardId?: string): Editor | null {
    if (!area) return null;
    const command = cardId
      ? { kind: "delete-card", areaId: area.id, cardId }
      : { kind: "delete-area", areaId: area.id };
    return {
      kind: "delete",
      command,
      title: cardId
        ? `Delete card: ${area.cards.find((card) => card.id === cardId)?.front.slice(0, 150) ?? "this card"}?`
        : `Delete ${area.title}?`,
      ...bound(command),
    };
  }
  function schedulerEditor(): Editor {
    const settings = workspace?.schedulerSettings ?? { requestRetention: 0.9 };
    return {
      kind: "scheduler",
      retentionPercent: String(settings.requestRetention * 100),
      ...bound({ kind: "update-scheduler-settings", settings }),
    };
  }
  const [editor, setEditor] = useState<Editor | null>(() => {
    if (initialEditor === "scheduler") return schedulerEditor();
    if (initialEditor === "create-area") return areaEditor("create");
    if (initialEditor === "edit-area") return areaEditor("edit");
    if (initialEditor === "edit-card") return cardEditor(0);
    if (initialEditor === "basic" || initialEditor === "cloze")
      return cardEditor(undefined, initialEditor);
    if (initialEditor === "settings" && area)
      return {
        kind: "settings",
        areaId: area.id,
        settings: settingsFor(area),
        tagsText: formatTagInput(area.tags ?? []),
        ...bound({ kind: "delete-area", areaId: area.id }),
      };
    if (initialEditor === "delete-area") return deleteEditor();
    if (initialEditor === "delete-card") return deleteEditor(area?.cards[0]?.id);
    return null;
  });
  const [query, setQuery] = useState(initialSearch ?? "");
  const [objectiveSelection, setObjectiveSelection] = useState({
    areaId: area?.id ?? null,
    value: initialObjectiveFilter ?? "",
  });
  const objectiveFilter =
    objectiveSelection.areaId === (area?.id ?? null) ? objectiveSelection.value : "";
  const objectives = area?.objectives ?? [];
  const legacyObjectives = [...new Set(area?.cards.map((card) => card.objective) ?? [])].filter(
    (title) => !objectives.some((objective) => objective.title === title),
  );

  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(initialMessage ?? null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const mounted = useRef(true);
  const editorGeneration = useRef(0);
  const pickerToken = useRef<number | null>(null);
  const saveActive = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      editorGeneration.current += 1;
    };
  }, []);
  const [submitGuard] = useState(() => {
    let active = false;
    return {
      enter: () => {
        if (active) return false;
        active = true;
        return true;
      },
      leave: () => {
        active = false;
      },
    };
  });
  const locked = disabled || pending || picking;
  function open(next: Editor | null) {
    if (disabled || saveActive.current || (pickerToken.current !== null && next !== null)) return;
    editorGeneration.current += 1;
    pickerToken.current = null;
    setPicking(false);
    setEditor(next);
    setConfirmation("");
    setMessage(null);
  }
  function submit(command: unknown, expectedBaseline?: string) {
    if (disabled || pickerToken.current !== null || !submitGuard.enter()) return;
    saveActive.current = true;
    const generation = editorGeneration.current;
    const assets =
      editor?.kind === "card"
        ? editor.stagedAssets.filter((asset) =>
            editor.content.media.some((reference) => reference.id === asset.reference.id),
          )
        : [];
    setPending(true);
    setMessage(null);
    Effect.runFork(
      Effect.tryPromise({
        try: () => onCommand(command, expectedBaseline, assets),
        catch: () => ({ _tag: "AuthoringPersistenceFailure" }) as const,
      }).pipe(
        Effect.match({
          onFailure: () => {
            if (mounted.current && editorGeneration.current === generation)
              setMessage("This change could not be saved. Your draft remains here; try again.");
          },
          onSuccess: (result) => {
            if (!mounted.current || editorGeneration.current !== generation) return;
            setMessage(result.message);
            if (result.ok) {
              setEditor(null);
              setConfirmation("");
            }
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            submitGuard.leave();
            saveActive.current = false;
            if (mounted.current) setPending(false);
          }),
        ),
      ),
    );
  }
  async function pickAttachment() {
    if (
      disabled ||
      saveActive.current ||
      pickerToken.current !== null ||
      !onPickAttachment ||
      editor?.kind !== "card"
    )
      return;
    if (editor.content.media.length >= 20) {
      setMessage("A card can have up to 20 attachments. Remove one before adding another.");
      return;
    }
    const generation = editorGeneration.current;
    pickerToken.current = generation;
    setPicking(true);
    setMessage(null);
    const result = await Effect.runPromise(Effect.either(onPickAttachment()));
    if (
      !mounted.current ||
      editorGeneration.current !== generation ||
      pickerToken.current !== generation
    )
      return;
    pickerToken.current = null;
    setPicking(false);
    if (Either.isLeft(result)) {
      setMessage(result.left.message);
      return;
    }
    const asset = result.right;
    if (!asset) return;
    const reference = Schema.decodeUnknownEither(MediaReferenceSchema)(asset.reference);
    if (
      Either.isLeft(reference) ||
      asset.bytes.byteLength !== asset.reference.byteLength ||
      !isSupportedMediaContent(asset.bytes, asset.reference.mimeType)
    ) {
      setMessage("Choose a supported image or audio file smaller than 20 MB.");
      return;
    }
    setEditor((current) => {
      if (current?.kind !== "card" || current.id !== editor.id) return current;
      if (current.content.media.some((item) => item.id === asset.reference.id)) return current;
      return {
        ...current,
        content: { ...current.content, media: [...current.content.media, asset.reference] },
        stagedAssets: [...current.stagedAssets, asset],
      };
    });
  }
  const field = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    multiline = false,
    maxLength?: number,
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!locked}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        {...(maxLength === undefined ? {} : { maxLength })}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
  const editorArea =
    editor && "areaId" in editor
      ? workspace?.areas.find((item) => item.id === editor.areaId)
      : area;
  const filteredCards =
    area?.cards.filter((card) => {
      const matchesSearch =
        `${card.front} ${card.back} ${card.tags?.join(" ") ?? ""} ${card.objective}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase());
      const matchesObjective =
        !objectiveFilter ||
        objectives.some(
          (objective) =>
            `id:${objective.id}` === objectiveFilter &&
            ((card.objectiveIds ?? []).includes(objective.id) ||
              card.objective === objective.title),
        ) ||
        `title:${card.objective}` === objectiveFilter;
      return matchesSearch && matchesObjective;
    }) ?? [];
  return (
    <View style={styles.panel} testID="native-workspace-authoring">
      <Text style={styles.eyebrow}>OFFLINE LIBRARY</Text>
      <Text style={styles.title}>Manage your learning</Text>
      {disabledReason && (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {disabledReason}
        </Text>
      )}
      {
        <NativeButton
          label={"Create learning area"}
          tone="soft"
          disabled={locked}
          onPress={() => open(areaEditor("create"))}
        />
      }
      {
        <NativeButton
          label={"Private review settings"}
          tone="soft"
          disabled={locked || !workspace}
          onPress={() => open(schedulerEditor())}
        />
      }
      {area && (
        <>
          <Text style={styles.heading}>{area.title}</Text>
          {
            <NativeButton
              label={"Rename or change color"}
              tone="soft"
              disabled={locked}
              onPress={() => open(areaEditor("edit"))}
            />
          }
          {
            <NativeButton
              label={"Area settings and objectives"}
              tone="soft"
              disabled={locked}
              onPress={() =>
                open({
                  kind: "settings",
                  areaId: area.id,
                  settings: settingsFor(area),
                  tagsText: formatTagInput(area.tags ?? []),
                  ...bound({ kind: "delete-area", areaId: area.id }),
                })
              }
            />
          }
          {
            <NativeButton
              label={"Delete learning area"}
              tone="soft"
              disabled={locked}
              onPress={() => open(deleteEditor())}
            />
          }
          {
            <NativeButton
              label={"Add Basic card"}
              tone="soft"
              disabled={locked}
              onPress={() => open(cardEditor())}
            />
          }
          {
            <NativeButton
              label={"Add Cloze card"}
              tone="soft"
              disabled={locked}
              onPress={() => open(cardEditor(undefined, "cloze"))}
            />
          }
        </>
      )}
      {editor?.kind === "scheduler" && (
        <View style={styles.editor}>
          <Text style={styles.heading}>Private review settings</Text>
          <Text style={styles.label}>FSRS target retention</Text>
          <Text style={styles.hint}>
            Choose the chance of remembering a card when it is due. Higher targets mean more
            frequent reviews. Start at 90%.
          </Text>
          {field(
            "Target retention (%) · 70 to 97",
            editor.retentionPercent,
            (retentionPercent) => setEditor({ ...editor, retentionPercent }),
            false,
            20,
          )}
          <View style={styles.row}>
            {([70, 90, 97] as const).map((percent) => (
              <Pressable
                key={percent}
                disabled={locked}
                accessibilityRole="button"
                accessibilityState={{
                  selected: editor.retentionPercent === String(percent),
                  disabled: locked,
                }}
                style={styles.choice}
                onPress={() => setEditor({ ...editor, retentionPercent: String(percent) })}
              >
                <Text>{percent}%</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            This target applies to future reviews. Existing due dates and append-only review history
            stay unchanged. This private preference is excluded from published content.
          </Text>
          {
            <NativeButton
              label={pending ? "Saving…" : "Save review settings"}
              tone="soft"
              disabled={locked}
              onPress={() => {
                const decoded = Schema.decodeUnknownEither(SchedulerSettingsSchema)({
                  requestRetention: Number(editor.retentionPercent) / 100,
                });
                if (Either.isLeft(decoded)) {
                  setMessage("Choose a target retention between 70% and 97%.");
                  return;
                }
                submit(
                  { kind: "update-scheduler-settings", settings: decoded.right },
                  editor.baseline,
                );
              }}
            />
          }
        </View>
      )}
      {editor?.kind === "area" && (
        <View style={styles.editor}>
          <Text style={styles.heading}>
            {editor.mode === "create" ? "New learning area" : "Edit learning area"}
          </Text>
          {field("Area title", editor.title, (title) => setEditor({ ...editor, title }), false, 80)}
          {field(
            "Color (#RRGGBB)",
            editor.color,
            (color) => setEditor({ ...editor, color }),
            false,
            7,
          )}
          {
            <NativeButton
              label={pending ? "Saving…" : "Save area"}
              tone="soft"
              disabled={locked}
              onPress={() =>
                submit(
                  {
                    kind: "save-area",
                    mode: editor.mode,
                    id: editor.id,
                    title: editor.title,
                    color: editor.color,
                  },
                  editor.baseline,
                )
              }
            />
          }
        </View>
      )}
      {editor?.kind === "card" && (
        <View style={styles.editor}>
          <Text style={styles.heading}>{editor.mode === "create" ? "New card" : "Edit card"}</Text>
          <View style={styles.row}>
            {(["basic", "cloze"] as const).map((kind) => (
              <Pressable
                key={kind}
                disabled={locked}
                accessibilityRole="radio"
                accessibilityState={{ selected: editor.content.kind === kind, disabled: locked }}
                style={styles.choice}
                onPress={() =>
                  setEditor({
                    ...editor,
                    content: {
                      ...editor.content,
                      kind,
                      ...(kind === "cloze" && !editor.content.cloze
                        ? { cloze: { text: "", deletionIndex: 1 } }
                        : {}),
                    },
                  })
                }
              >
                <Text>{kind === "basic" ? "Basic" : "Cloze"}</Text>
              </Pressable>
            ))}
          </View>
          {editor.content.kind === "basic" ? (
            <>
              {field(
                "Question",
                editor.content.front,
                (front) => setEditor({ ...editor, content: { ...editor.content, front } }),
                true,
              )}
              {field(
                "Answer",
                editor.content.back,
                (back) => setEditor({ ...editor, content: { ...editor.content, back } }),
                true,
              )}
            </>
          ) : (
            <>
              {field(
                "Cloze text",
                editor.content.cloze?.text ?? "",
                (text) =>
                  setEditor({
                    ...editor,
                    content: {
                      ...editor.content,
                      cloze: { text, deletionIndex: editor.content.cloze?.deletionIndex ?? 1 },
                    },
                  }),
                true,
                20000,
              )}
              <Text style={styles.hint}>
                {"Example: Mitochondria produce {{c1::ATP::energy molecule}}."}
              </Text>
              {field("Deletion index", String(editor.content.cloze?.deletionIndex ?? 1), (index) =>
                setEditor({
                  ...editor,
                  content: {
                    ...editor.content,
                    cloze: { text: editor.content.cloze?.text ?? "", deletionIndex: Number(index) },
                  },
                }),
              )}
            </>
          )}
          {field(
            "Card tags (comma separated)",
            editor.tagsText,
            (tagsText) => setEditor({ ...editor, tagsText }),
            true,
          )}
          <Text style={styles.hint}>
            Separate tags with commas. Quote tags containing commas; double embedded quotes inside a
            quoted tag.
          </Text>
          <Text style={styles.label}>Learning objectives</Text>
          {editorArea?.objectives?.map((objective) => (
            <Pressable
              key={objective.id}
              disabled={locked}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: editor.content.objectiveIds.includes(objective.id),
                disabled: locked,
              }}
              onPress={() =>
                setEditor({
                  ...editor,
                  content: {
                    ...editor.content,
                    objectiveIds: editor.content.objectiveIds.includes(objective.id)
                      ? editor.content.objectiveIds.filter((id) => id !== objective.id)
                      : [...editor.content.objectiveIds, objective.id],
                  },
                })
              }
              style={styles.choice}
            >
              <Text>
                {editor.content.objectiveIds.includes(objective.id) ? "☑" : "☐"} {objective.title}
              </Text>
            </Pressable>
          ))}
          {editor.content.media.map((attachment) => (
            <View key={attachment.id}>
              <Text style={styles.hint}>
                {attachment.mimeType} · {attachment.id.slice(0, 12)}
              </Text>
              {
                <NativeButton
                  label={"Remove attachment"}
                  tone="soft"
                  disabled={locked}
                  onPress={() =>
                    setEditor({
                      ...editor,
                      content: {
                        ...editor.content,
                        media: editor.content.media.filter((item) => item.id !== attachment.id),
                      },
                      stagedAssets: editor.stagedAssets.filter(
                        (asset) => asset.reference.id !== attachment.id,
                      ),
                    })
                  }
                />
              }
            </View>
          ))}
          {onPickAttachment && (
            <NativeButton
              label={picking ? "Choosing attachment…" : "Add image or audio"}
              tone="soft"
              disabled={locked || editor.content.media.length >= 20}
              onPress={() => {
                void pickAttachment();
              }}
            />
          )}
          <Text style={styles.hint}>
            Attachments are saved with your card. Your draft stays available if saving fails.
          </Text>
          {
            <NativeButton
              label={pending ? "Saving…" : "Save card"}
              tone="soft"
              disabled={locked}
              onPress={() => {
                const tags = parseTagInput(editor.tagsText);
                if (Either.isLeft(tags)) {
                  setMessage(tags.left.message);
                  return;
                }
                submit(
                  {
                    kind: editor.mode === "create" ? "create-card" : "update-card",
                    areaId: editor.areaId,
                    cardId: editor.id,
                    content: { ...editor.content, tags: tags.right },
                  },
                  editor.baseline,
                );
              }}
            />
          }
        </View>
      )}
      {editor?.kind === "settings" && (
        <View style={styles.editor}>
          <Text style={styles.heading}>Area settings and objectives</Text>
          {field(
            "Description",
            editor.settings.description ?? "",
            (description) =>
              setEditor({ ...editor, settings: { ...editor.settings, description } }),
            true,
          )}
          {field(
            "Language",
            editor.settings.language,
            (language) => setEditor({ ...editor, settings: { ...editor.settings, language } }),
            false,
            80,
          )}
          {field(
            "Area tags (comma separated)",
            editor.tagsText,
            (tagsText) => setEditor({ ...editor, tagsText }),
            true,
          )}
          <Text style={styles.hint}>
            Separate tags with commas. Quote tags containing commas; double embedded quotes inside a
            quoted tag.
          </Text>
          {field(
            "License",
            editor.settings.licence ?? "",
            (licence) => setEditor({ ...editor, settings: { ...editor.settings, licence } }),
            false,
            120,
          )}
          {field(
            "Attribution",
            editor.settings.attribution ?? "",
            (attribution) =>
              setEditor({ ...editor, settings: { ...editor.settings, attribution } }),
            false,
            500,
          )}
          {field(
            "Tutor instructions",
            editor.settings.ai.tutorInstructions,
            (tutorInstructions) =>
              setEditor({
                ...editor,
                settings: { ...editor.settings, ai: { ...editor.settings.ai, tutorInstructions } },
              }),
            true,
            2000,
          )}
          {field(
            "Quiz instructions",
            editor.settings.ai.quizInstructions ?? "",
            (quizInstructions) =>
              setEditor({
                ...editor,
                settings: { ...editor.settings, ai: { ...editor.settings.ai, quizInstructions } },
              }),
            true,
            2000,
          )}
          {field(
            "Card generation instructions",
            editor.settings.ai.cardGenerationInstructions ?? "",
            (cardGenerationInstructions) =>
              setEditor({
                ...editor,
                settings: {
                  ...editor.settings,
                  ai: { ...editor.settings.ai, cardGenerationInstructions },
                },
              }),
            true,
            2000,
          )}
          <Text style={styles.hint}>
            AI instructions guide proposals; generated cards still require approval.
          </Text>
          {editor.settings.objectives.map((objective) => (
            <View key={objective.id} style={styles.editor}>
              {field("Objective title", objective.title, (title) =>
                setEditor({
                  ...editor,
                  settings: {
                    ...editor.settings,
                    objectives: editor.settings.objectives.map((item) =>
                      item.id === objective.id ? { ...item, title } : item,
                    ),
                  },
                }),
              )}
              {field(
                "Objective description",
                objective.description ?? "",
                (description) =>
                  setEditor({
                    ...editor,
                    settings: {
                      ...editor.settings,
                      objectives: editor.settings.objectives.map((item) =>
                        item.id === objective.id ? { ...item, description } : item,
                      ),
                    },
                  }),
                true,
              )}
              <Text style={styles.label}>Prerequisites</Text>
              {editor.settings.objectives
                .filter((item) => item.id !== objective.id)
                .map((prerequisite) => (
                  <Pressable
                    key={prerequisite.id}
                    disabled={locked}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: objective.prerequisiteIds.includes(prerequisite.id),
                      disabled: locked,
                    }}
                    style={styles.choice}
                    onPress={() =>
                      setEditor({
                        ...editor,
                        settings: {
                          ...editor.settings,
                          objectives: editor.settings.objectives.map((item) =>
                            item.id === objective.id
                              ? {
                                  ...item,
                                  prerequisiteIds: item.prerequisiteIds.includes(prerequisite.id)
                                    ? item.prerequisiteIds.filter((id) => id !== prerequisite.id)
                                    : [...item.prerequisiteIds, prerequisite.id],
                                }
                              : item,
                          ),
                        },
                      })
                    }
                  >
                    <Text>
                      {objective.prerequisiteIds.includes(prerequisite.id) ? "☑" : "☐"}{" "}
                      {prerequisite.title}
                    </Text>
                  </Pressable>
                ))}
              {
                <NativeButton
                  label={"Remove objective"}
                  tone="soft"
                  disabled={locked}
                  onPress={() =>
                    setEditor({
                      ...editor,
                      settings: {
                        ...editor.settings,
                        objectives: editor.settings.objectives
                          .filter((item) => item.id !== objective.id)
                          .map((item) => ({
                            ...item,
                            prerequisiteIds: item.prerequisiteIds.filter(
                              (id) => id !== objective.id,
                            ),
                          })),
                      },
                    })
                  }
                />
              }
            </View>
          ))}
          {
            <NativeButton
              label={"Add objective"}
              tone="soft"
              disabled={locked}
              onPress={() =>
                setEditor({
                  ...editor,
                  settings: {
                    ...editor.settings,
                    objectives: [
                      ...editor.settings.objectives,
                      {
                        id: createObjectiveId(createId()),
                        title: "",
                        description: null,
                        prerequisiteIds: [],
                      },
                    ],
                  },
                })
              }
            />
          }
          {
            <NativeButton
              label={pending ? "Saving…" : "Save settings"}
              tone="soft"
              disabled={locked}
              onPress={() => {
                const tags = parseTagInput(editor.tagsText);
                if (Either.isLeft(tags)) {
                  setMessage(tags.left.message);
                  return;
                }
                submit(
                  {
                    kind: "update-area-settings",
                    areaId: editor.areaId,
                    settings: { ...editor.settings, tags: tags.right },
                  },
                  editor.baseline,
                );
              }}
            />
          }
        </View>
      )}
      {editor?.kind === "delete" && (
        <View style={styles.editor}>
          <Text style={styles.heading}>{editor.title}</Text>
          <Text style={styles.hint}>
            Active content is removed. Append-only review history remains available in private
            backups. Type DELETE to confirm.
          </Text>
          {field("Deletion confirmation", confirmation, setConfirmation)}
          {
            <NativeButton
              label={"Confirm deletion"}
              tone="soft"
              disabled={locked || confirmation !== "DELETE"}
              onPress={() => submit(editor.command, editor.baseline)}
            />
          }
        </View>
      )}
      {editor && (
        <NativeButton
          label="Cancel editing"
          tone="soft"
          disabled={disabled || pending}
          onPress={() => open(null)}
        />
      )}
      {area && (
        <>
          <Text style={styles.heading}>All cards · {area.cards.length}</Text>
          {field("Search cards, answers, tags or objectives", query, setQuery)}
          <Text style={styles.label}>Filter by learning objective</Text>
          {[
            { value: "", title: "All objectives" },
            ...objectives.map((objective) => ({
              value: `id:${objective.id}`,
              title: objective.title,
            })),
            ...legacyObjectives.map((title) => ({ value: `title:${title}`, title })),
          ].map((choice) => (
            <Pressable
              key={choice.value}
              disabled={locked}
              accessibilityRole="radio"
              accessibilityState={{ selected: objectiveFilter === choice.value, disabled: locked }}
              style={styles.choice}
              onPress={() => setObjectiveSelection({ areaId: area.id, value: choice.value })}
            >
              <Text>
                {objectiveFilter === choice.value ? "◉" : "○"} {choice.title}
              </Text>
            </Pressable>
          ))}
          <Text accessibilityLiveRegion="polite" style={styles.hint}>
            {filteredCards.length} of {area.cards.length} cards
          </Text>

          {filteredCards.map((card) => (
            <View key={card.id} style={styles.editor}>
              <Text style={styles.label}>{card.front}</Text>
              <Text style={styles.hint}>{card.tags?.join(" · ") || card.objective}</Text>
              {
                <NativeButton
                  label={"Edit card"}
                  tone="soft"
                  disabled={locked}
                  onPress={() =>
                    open(cardEditor(area.cards.findIndex((item) => item.id === card.id)))
                  }
                />
              }
              {
                <NativeButton
                  label={"Delete card"}
                  tone="soft"
                  disabled={locked}
                  onPress={() => open(deleteEditor(card.id))}
                />
              }
            </View>
          ))}
          {filteredCards.length === 0 && (
            <Text style={styles.hint}>
              {query || objectiveFilter
                ? "No cards match this search and objective filter."
                : "Add your first card to this area."}
            </Text>
          )}
        </>
      )}
      {message && (
        <Text accessibilityRole="alert" style={styles.hint}>
          {message}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 9, padding: 16, backgroundColor: palette.surface },
  editor: { gap: 8, padding: 12, backgroundColor: palette.paper, borderRadius: 12 },
  field: { gap: 5 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 9,
    padding: 10,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  multiline: { minHeight: 90, textAlignVertical: "top" },
  eyebrow: { color: palette.darkGreen, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  title: { color: palette.ink, fontSize: 20, fontWeight: "700" },
  heading: { color: palette.ink, fontSize: 16, fontWeight: "700" },
  label: { color: palette.ink, fontSize: 13, fontWeight: "600" },
  hint: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8 },
  choice: { padding: 10, backgroundColor: palette.surface, borderRadius: 8 },
});
