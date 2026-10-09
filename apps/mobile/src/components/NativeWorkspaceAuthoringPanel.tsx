import { NativeButton } from "./ui/NativeButton";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Effect, Schema, Either } from "effect";
import {
  workspaceAuthoringBaseline,
  isSupportedMediaContent,
  formatTagInput,
  parseTagInput,
  WorkspaceAuthoringCommandSchema,
  createCardAssistanceTutor,
  refinementCardContent,
  findCardDuplicates,
  findDuplicateCardPairs,
  workspaceDuplicateCandidates,
  toKnowledgeArea,
  type AreaSettings,
  type CardContent,
  type WorkspaceSearchResult,
} from "@recall/application";
import {
  SchedulerSettingsSchema,
  MediaReferenceSchema,
  createObjectiveId,
  type LearningArea,
  type Workspace,
} from "@recall/domain";

import type { StoredMediaAsset } from "@recall/local-store";
import type { CardProposal, CardRefinementResult } from "@recall/ai-core";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";
import { NativeCardHistoryPanel } from "./NativeCardHistoryPanel";
import { NativeCardAssistancePanel } from "./NativeCardAssistancePanel";

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
  readonly tutorApi?: ReturnType<typeof makeNativeTutorApi> | null;
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
  readonly initialShowDuplicates?: boolean;
  readonly initialHistory?: boolean;
  readonly searchTarget?: WorkspaceSearchResult | null;
};
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
  tutorApi = null,
  disabled = false,
  disabledReason,
  createId,
  onCommand,
  onPickAttachment,
  initialEditor,
  initialMessage,
  initialObjectiveFilter,
  initialSearch,
  searchTarget,
  initialShowDuplicates = false,
  initialHistory = false,
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
      color: mode === "edit" ? (area?.color ?? "#3b82f6") : "#3b82f6",
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
  const [editor, setEditorState] = useState<Editor | null>(() => {
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
  const [refinementDuplicate, setRefinementDuplicate] = useState<{
    readonly result: CardRefinementResult;
    readonly key: string;
    readonly descriptions: readonly string[];
  } | null>(null);
  const [history, setHistory] = useState<{
    readonly areaId?: string;
    readonly cardId?: string;
  } | null>(initialHistory ? {} : null);
  const [showDuplicates, setShowDuplicates] = useState(initialShowDuplicates);
  const [keptDuplicateDraft, setKeptDuplicateDraft] = useState<string | null>(null);
  function setEditor(update: SetStateAction<Editor | null>) {
    setKeptDuplicateDraft(null);
    setEditorState(update);
  }
  const [areaMenu, setAreaMenu] = useState(false);
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(Boolean(initialObjectiveFilter));
  const [showCardDetails, setShowCardDetails] = useState(false);
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
    setAreaMenu(false);
    setCardMenuId(null);
    setShowCardDetails(false);
    setRefinementDuplicate(null);
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
    <View className={"gap-[5px]"}>
      <Text className={"text-recall-ink text-[13px] font-semibold"}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!locked}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        {...(maxLength === undefined ? {} : { maxLength })}
        className={`min-h-[44px] border border-recall-line rounded-[9px] p-[10px] text-recall-ink bg-recall-surface ${multiline ? "min-h-[90px]" : ""}`}
        style={multiline ? { textAlignVertical: "top" } : undefined}
      />
    </View>
  );
  const editorArea =
    editor && "areaId" in editor
      ? workspace?.areas.find((item) => item.id === editor.areaId)
      : area;
  const assistanceArea = editorArea
    ? Effect.runSync(Effect.either(toKnowledgeArea(editorArea, false, true)))
    : null;
  const assistanceContent: CardProposal | null =
    editor?.kind === "card"
      ? {
          front:
            editor.content.kind === "cloze"
              ? (editor.content.cloze?.text ?? "")
              : editor.content.front,
          back: editor.content.back,
          objectiveId: editor.content.objectiveIds[0] ?? null,
          rationale: "Improve this library card.",
        }
      : null;
  async function applyRefinement(
    result: CardRefinementResult,
    acceptedKey?: string,
  ): Promise<boolean> {
    if (editor?.kind !== "card" || locked || !submitGuard.enter()) return false;
    const generation = editorGeneration.current;
    const tags = parseTagInput(editor.tagsText);
    if (Either.isLeft(tags)) {
      setMessage(tags.left.message);
      submitGuard.leave();
      return false;
    }
    const converted = Effect.runSync(
      Effect.either(
        Effect.all(
          result.cards.map((card) =>
            refinementCardContent(card, { ...editor.content, tags: tags.right }),
          ),
        ),
      ),
    );
    if (Either.isLeft(converted)) {
      setMessage(converted.left.message);
      submitGuard.leave();
      return false;
    }
    const first = converted.right[0];
    if (!first) {
      submitGuard.leave();
      return false;
    }
    if (
      converted.right.length === 1 &&
      result.cards[0]?.meaningChanged === false &&
      first.kind === editor.content.kind
    ) {
      setEditor({ ...editor, content: first });
      setMessage("Refinement applied to your draft. Save the card to keep the wording change.");
      submitGuard.leave();
      return true;
    }
    const proposedCandidates = converted.right.map((content, index) => ({
      id: `proposed:${index}`,
      front: content.front,
      back: content.back,
      ...(content.cloze ? { cloze: content.cloze } : {}),
    }));
    const checks = converted.right.flatMap((content, index) =>
      findCardDuplicates(
        {
          front: content.front,
          back: content.back,
          ...(content.cloze ? { cloze: content.cloze } : {}),
        },
        [
          ...(workspace
            ? workspaceDuplicateCandidates(workspace).filter(
                (candidate) => candidate.id !== editor.id,
              )
            : []),
          ...proposedCandidates.filter((_candidate, candidateIndex) => candidateIndex < index),
        ],
        { limit: 5 },
      ),
    );
    const comparisonKey = JSON.stringify([editor.id, editor.content, result, checks]);
    if (checks.length > 0 && acceptedKey !== comparisonKey) {
      setRefinementDuplicate({
        result,
        key: comparisonKey,
        descriptions: checks.map((match) => `${match.candidate.front} · ${match.reason}`),
      });
      setMessage(
        "This refinement overlaps existing cards. Review the matches before keeping both.",
      );
      submitGuard.leave();
      return false;
    }
    setRefinementDuplicate(null);
    const cards = converted.right.map((content) => ({ cardId: createId(), content }));
    const command =
      editor.mode === "edit"
        ? { kind: "replace-card", areaId: editor.areaId, cardId: editor.id, cards }
        : { kind: "create-cards", areaId: editor.areaId, cards };
    saveActive.current = true;
    setPending(true);
    const saved = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => onCommand(command, editor.baseline, editor.stagedAssets),
          catch: () => ({
            message: "This refinement could not be saved. Your draft remains available.",
          }),
        }),
      ),
    );
    saveActive.current = false;
    submitGuard.leave();
    if (!mounted.current || editorGeneration.current !== generation) return false;
    setPending(false);
    if (Either.isLeft(saved)) {
      setMessage(saved.left.message);
      return false;
    }
    setMessage(saved.right.message);
    if (saved.right.ok) {
      setEditor(null);
      setConfirmation("");
    }
    return saved.right.ok;
  }
  const duplicateCandidates = workspace ? workspaceDuplicateCandidates(workspace) : [];
  const draftDuplicates =
    editor?.kind === "card"
      ? findCardDuplicates(
          {
            front: editor.content.front,
            back: editor.content.back,
            ...(editor.content.cloze ? { cloze: editor.content.cloze } : {}),
          },
          duplicateCandidates,
          { excludeCardId: editor.id, limit: 5 },
        )
      : [];
  const duplicateDraftKey =
    editor?.kind === "card" ? JSON.stringify([editor.id, editor.content, draftDuplicates]) : "";
  const duplicatesAccepted = keptDuplicateDraft === duplicateDraftKey;
  const duplicatePairs = showDuplicates
    ? findDuplicateCardPairs(duplicateCandidates, { limit: 50 })
    : [];
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
    <View className={"gap-[12px]"} testID="native-workspace-authoring">
      {message && (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[12px] leading-[18px]"}>
          {message}
        </Text>
      )}
      {disabledReason && (
        <Text
          accessibilityLiveRegion="polite"
          className={"text-recall-muted text-[12px] leading-[18px]"}
        >
          {disabledReason}
        </Text>
      )}
      {
        <NativeButton
          label="New area"
          tone="soft"
          disabled={locked}
          onPress={() => open(areaEditor("create"))}
        />
      }
      {searchTarget && workspace && (
        <View className={"gap-[8px] pb-[12px]"}>
          <Text className={"text-recall-ink text-[13px] font-semibold"}>{searchTarget.title}</Text>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            {searchTarget.snippet}
          </Text>
          {searchTarget.target.kind === "card" && (
            <NativeButton
              label={editor ? "Discard draft and open selected card" : "Edit selected card"}
              tone="soft"
              disabled={locked}
              onPress={() => {
                const target = searchTarget.target;
                if (target.kind !== "card") return;
                const foundArea = workspace.areas.find((item) => item.id === searchTarget.areaId);
                const card = foundArea?.cards.find((item) => item.id === target.cardId);
                if (!foundArea || !card) return;
                open({
                  kind: "card",
                  mode: "edit",
                  areaId: foundArea.id,
                  id: card.id,
                  tagsText: formatTagInput(card.tags ?? []),
                  stagedAssets: [],
                  content: {
                    kind: card.cloze ? "cloze" : "basic",
                    front: card.front,
                    back: card.back,
                    ...(card.cloze ? { cloze: card.cloze } : {}),
                    objectiveIds: card.objectiveIds ?? [],
                    tags: card.tags ?? [],
                    media: card.media ?? [],
                  },
                  ...bound({ kind: "delete-card", areaId: foundArea.id, cardId: card.id }),
                });
              }}
            />
          )}
          {searchTarget.target.kind === "objective" && (
            <NativeButton
              label="Filter cards by this objective"
              tone="soft"
              onPress={() => {
                if (searchTarget.target.kind !== "objective") return;
                setObjectiveSelection({
                  areaId: searchTarget.areaId,
                  value: `id:${searchTarget.target.objectiveId}`,
                });
                setShowFilters(true);
              }}
            />
          )}
        </View>
      )}
      {workspace && (
        <View className={"gap-[8px] pb-[12px]"}>
          <NativeButton
            label={history ? "Hide history" : "Card history and recovery"}
            tone="soft"
            disabled={locked}
            onPress={() => setHistory(history ? null : {})}
          />
          {history && editor && (
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              Save or cancel your draft before restoring a version.
            </Text>
          )}
          {history && (
            <NativeCardHistoryPanel
              workspace={workspace}
              {...history}
              disabled={locked || editor !== null}
              onRestore={(command, expectedBaseline) => submit(command, expectedBaseline)}
            />
          )}
          <NativeButton
            label={showDuplicates ? "Hide duplicates" : "Find duplicates"}
            tone="soft"
            disabled={locked}
            onPress={() => setShowDuplicates(!showDuplicates)}
          />
          {showDuplicates && (
            <View className={"gap-[8px] pb-[12px]"}>
              {duplicatePairs.length === 0 && (
                <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                  No likely duplicates found.
                </Text>
              )}
              {duplicatePairs.map((pair) => (
                <View
                  key={`${pair.left.id}:${pair.right.id}`}
                  className={"border-t border-recall-line py-[8px]"}
                >
                  <Text className={"text-recall-ink text-[13px] font-semibold"}>
                    {pair.left.front}
                  </Text>
                  <Text>{pair.right.front}</Text>
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    {pair.reason}
                  </Text>
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    {pair.left.areaTitle} · {pair.right.areaTitle}
                  </Text>
                  {[pair.left, pair.right].map((candidate) => (
                    <NativeButton
                      key={candidate.id}
                      label={`Edit: ${candidate.front.slice(0, 60)}`}
                      tone="soft"
                      disabled={locked}
                      onPress={() => {
                        const candidateArea = workspace.areas.find(
                          (item) => item.id === candidate.areaId,
                        );
                        const card = candidateArea?.cards.find((item) => item.id === candidate.id);
                        if (!candidateArea || !card) return;
                        open({
                          kind: "card",
                          mode: "edit",
                          areaId: candidateArea.id,
                          id: card.id,
                          tagsText: formatTagInput(card.tags ?? []),
                          stagedAssets: [],
                          content: {
                            kind: card.cloze ? "cloze" : "basic",
                            front: card.front,
                            back: card.back,
                            ...(card.cloze ? { cloze: card.cloze } : {}),
                            objectiveIds: card.objectiveIds ?? [],
                            tags: card.tags ?? [],
                            media: card.media ?? [],
                          },
                          ...bound({
                            kind: "delete-card",
                            areaId: candidateArea.id,
                            cardId: card.id,
                          }),
                        });
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      {area && (
        <>
          <View className={"flex-row items-center justify-between gap-[12px]"}>
            <Text className={"text-recall-ink text-[16px] font-bold"}>{area.title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Area actions"
              accessibilityState={{ expanded: areaMenu, disabled: locked }}
              disabled={locked}
              onPress={() => setAreaMenu((value) => !value)}
              className={"min-w-[44px] min-h-[44px] items-center justify-center"}
            >
              <Text className={"text-recall-ink text-[16px] font-bold"}>⋯</Text>
            </Pressable>
          </View>
          {areaMenu && (
            <View className={"gap-[8px] pb-[12px]"}>
              <NativeButton
                label="Rename area"
                tone="soft"
                disabled={locked}
                onPress={() => open(areaEditor("edit"))}
              />
              <NativeButton
                label="Area settings"
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
              <NativeButton
                label="Review settings"
                tone="soft"
                disabled={locked || !workspace}
                onPress={() => open(schedulerEditor())}
              />
              <NativeButton
                label="Delete area"
                tone="soft"
                disabled={locked}
                onPress={() => open(deleteEditor())}
              />
            </View>
          )}
          {
            <NativeButton
              label="Add card"
              tone="soft"
              disabled={locked}
              onPress={() => open(cardEditor())}
            />
          }
        </>
      )}
      {editor?.kind === "scheduler" && (
        <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
          <Text className={"text-recall-ink text-[16px] font-bold"}>Review settings</Text>
          <Text className={"text-recall-ink text-[13px] font-semibold"}>Remembering target</Text>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
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
          <View className={"flex-row gap-[8px]"}>
            {([70, 90, 97] as const).map((percent) => (
              <Pressable
                key={percent}
                disabled={locked}
                accessibilityRole="button"
                accessibilityState={{
                  selected: editor.retentionPercent === String(percent),
                  disabled: locked,
                }}
                className={"p-[10px] bg-recall-surface rounded-[8px]"}
                onPress={() => setEditor({ ...editor, retentionPercent: String(percent) })}
              >
                <Text>{percent}%</Text>
              </Pressable>
            ))}
          </View>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            Applies to future reviews.
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
        <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
          <Text className={"text-recall-ink text-[16px] font-bold"}>
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
        <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
          <Text className={"text-recall-ink text-[16px] font-bold"}>
            {editor.mode === "create" ? "New card" : "Edit card"}
          </Text>
          <View className={"flex-row gap-[8px]"}>
            {(["basic", "cloze"] as const).map((kind) => (
              <Pressable
                key={kind}
                disabled={locked}
                accessibilityRole="radio"
                accessibilityState={{ selected: editor.content.kind === kind, disabled: locked }}
                className={"p-[10px] bg-recall-surface rounded-[8px]"}
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
              <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
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
          {assistanceContent && (
            <NativeCardAssistancePanel
              key={editor.id}
              content={assistanceContent}
              disabled={locked}
              onApply={applyRefinement}
              {...(tutorApi && assistanceArea && Either.isRight(assistanceArea)
                ? {
                    onRefine: async (mode, instructions) => {
                      const result = await Effect.runPromise(
                        Effect.either(
                          createCardAssistanceTutor(tutorApi).refine(
                            null,
                            { knowledgeArea: assistanceArea.right, history: [] },
                            { ...assistanceContent, mode, instructions, sources: [] },
                            Date.now(),
                          ),
                        ),
                      );
                      if (Either.isLeft(result)) {
                        setMessage(result.left.message);
                        return null;
                      }
                      return result.right.result;
                    },
                    onInspect: async () => {
                      const result = await Effect.runPromise(
                        Effect.either(
                          createCardAssistanceTutor(tutorApi).inspect(
                            null,
                            { knowledgeArea: assistanceArea.right, history: [] },
                            { ...assistanceContent, sources: [] },
                            Date.now(),
                          ),
                        ),
                      );
                      if (Either.isLeft(result)) {
                        setMessage(result.left.message);
                        return null;
                      }
                      return result.right.result;
                    },
                  }
                : {})}
            />
          )}
          <NativeButton
            label={showCardDetails ? "Hide card details" : "Card details"}
            tone="soft"
            onPress={() => setShowCardDetails((value) => !value)}
          />
          {showCardDetails && (
            <>
              {field(
                "Card tags (comma separated)",
                editor.tagsText,
                (tagsText) => setEditor({ ...editor, tagsText }),
                true,
              )}
              <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                Separate tags with commas. Quote tags containing commas; double embedded quotes
                inside a quoted tag.
              </Text>
              <Text className={"text-recall-ink text-[13px] font-semibold"}>
                Learning objectives
              </Text>
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
                  className={"p-[10px] bg-recall-surface rounded-[8px]"}
                >
                  <Text>
                    {editor.content.objectiveIds.includes(objective.id) ? "☑" : "☐"}{" "}
                    {objective.title}
                  </Text>
                </Pressable>
              ))}
              {editor.content.media.map((attachment) => (
                <View key={attachment.id}>
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    {attachment.mimeType.startsWith("image/") ? "Image" : "Audio"} attachment
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
            </>
          )}
          {refinementDuplicate && (
            <View className={"gap-[8px] pb-[12px]"}>
              <Text className={"text-recall-ink text-[16px] font-bold"}>Refinement duplicates</Text>
              {refinementDuplicate.descriptions.map((description, index) => (
                <Text
                  key={`${index}:${description}`}
                  className={"text-recall-muted text-[12px] leading-[18px]"}
                >
                  {description}
                </Text>
              ))}
              <NativeButton
                label="Keep both and apply refinement"
                tone="soft"
                disabled={locked}
                onPress={() => {
                  void applyRefinement(refinementDuplicate.result, refinementDuplicate.key);
                }}
              />
              <NativeButton
                label="Cancel refinement"
                tone="soft"
                disabled={locked}
                onPress={() => setRefinementDuplicate(null)}
              />
            </View>
          )}
          {draftDuplicates.length > 0 && (
            <View className={"gap-[8px] pb-[12px]"}>
              <Text className={"text-recall-ink text-[16px] font-bold"}>Possible duplicates</Text>
              {draftDuplicates.map((match) => (
                <View key={match.candidate.id} className={"border-t border-recall-line py-[8px]"}>
                  <Text className={"text-recall-ink text-[13px] font-semibold"}>
                    {match.candidate.front}
                  </Text>
                  <Text>{match.candidate.back}</Text>
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    {match.candidate.areaTitle} · {match.reason}
                  </Text>
                </View>
              ))}
              <NativeButton
                label={duplicatesAccepted ? "Keep both selected" : "Keep both"}
                tone="soft"
                disabled={locked}
                onPress={() => setKeptDuplicateDraft(duplicateDraftKey)}
              />
            </View>
          )}
          {
            <NativeButton
              label={pending ? "Saving…" : "Save card"}
              tone="soft"
              disabled={locked}
              onPress={() => {
                if (draftDuplicates.length > 0 && !duplicatesAccepted) {
                  setMessage("Review the similar cards and choose Keep both to save this draft.");
                  return;
                }
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
        <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
          <Text className={"text-recall-ink text-[16px] font-bold"}>
            Area settings and objectives
          </Text>
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
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
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
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            AI instructions guide proposals; generated cards still require approval.
          </Text>
          {editor.settings.objectives.map((objective) => (
            <View key={objective.id} className={"gap-[12px] py-[16px] border-t border-recall-line"}>
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
              <Text className={"text-recall-ink text-[13px] font-semibold"}>Prerequisites</Text>
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
                    className={"p-[10px] bg-recall-surface rounded-[8px]"}
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
        <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
          <Text className={"text-recall-ink text-[16px] font-bold"}>{editor.title}</Text>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            This removes the card or area. Review history is kept. Type DELETE to confirm.
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
          <Text className={"text-recall-ink text-[16px] font-bold"}>
            All cards · {area.cards.length}
          </Text>
          {field("Search cards", query, setQuery)}
          {(objectives.length > 0 || legacyObjectives.length > 0) && (
            <NativeButton
              label={showFilters ? "Hide filters" : "Filter"}
              tone="soft"
              onPress={() => setShowFilters((value) => !value)}
            />
          )}
          {showFilters && (
            <>
              <Text className={"text-recall-ink text-[13px] font-semibold"}>
                Filter by learning objective
              </Text>
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
                  accessibilityState={{
                    selected: objectiveFilter === choice.value,
                    disabled: locked,
                  }}
                  className={"p-[10px] bg-recall-surface rounded-[8px]"}
                  onPress={() => setObjectiveSelection({ areaId: area.id, value: choice.value })}
                >
                  <Text>
                    {objectiveFilter === choice.value ? "◉" : "○"} {choice.title}
                  </Text>
                </Pressable>
              ))}
            </>
          )}
          <Text
            accessibilityLiveRegion="polite"
            className={"text-recall-muted text-[12px] leading-[18px]"}
          >
            {filteredCards.length} of {area.cards.length} cards
          </Text>

          {filteredCards.map((card) => (
            <View key={card.id} className={"border-t border-recall-line py-[8px]"}>
              <View className={"flex-row items-center justify-between gap-[12px]"}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${card.front}`}
                  disabled={locked}
                  accessibilityState={{ disabled: locked }}
                  onPress={() =>
                    open(cardEditor(area.cards.findIndex((item) => item.id === card.id)))
                  }
                  className={"flex-1 min-h-[44px] justify-center"}
                >
                  <Text className={"text-recall-ink text-[13px] font-semibold"}>{card.front}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Actions for ${card.front}`}
                  accessibilityState={{ expanded: cardMenuId === card.id, disabled: locked }}
                  disabled={locked}
                  onPress={() => setCardMenuId((value) => (value === card.id ? null : card.id))}
                  className={"min-w-[44px] min-h-[44px] items-center justify-center"}
                >
                  <Text className={"text-recall-ink text-[16px] font-bold"}>⋯</Text>
                </Pressable>
              </View>
              {cardMenuId === card.id && (
                <View className={"gap-[8px] pb-[12px]"}>
                  <NativeButton
                    label="Edit"
                    tone="soft"
                    disabled={locked}
                    onPress={() =>
                      open(cardEditor(area.cards.findIndex((item) => item.id === card.id)))
                    }
                  />
                  <NativeButton
                    label="Version history"
                    tone="soft"
                    disabled={locked}
                    onPress={() => setHistory({ areaId: area.id, cardId: card.id })}
                  />
                  <NativeButton
                    label="Delete"
                    tone="soft"
                    disabled={locked}
                    onPress={() => open(deleteEditor(card.id))}
                  />
                </View>
              )}
            </View>
          ))}
          {filteredCards.length === 0 && (
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              {query || objectiveFilter
                ? "No cards match this search and objective filter."
                : "Add your first card to this area."}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
