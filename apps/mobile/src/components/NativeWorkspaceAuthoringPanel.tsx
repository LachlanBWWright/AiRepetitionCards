import { NativeButton } from "./ui/NativeButton";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
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
  renderClozeCard,
  findCardDuplicates,
  findDuplicateCardPairs,
  workspaceDuplicateCandidates,
  toKnowledgeArea,
  type AreaSettings,
  type CardContent,
  type WorkspaceSearchResult,
  type LibraryNotes,
  type LibraryDraft,
  emptyLibraryNotes,
  summarizeStudySession,
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
      readonly sourceCard?: import("@recall/domain").Assessment;
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
  readonly flaggedOnly?: boolean;
  readonly onFlaggedFilterChange?: (value: boolean) => void;
  readonly notes?: LibraryNotes;
  readonly notesLoaded?: boolean;
  readonly onFlushDraft?: () => Promise<boolean>;
  readonly onRetainDraft?: (draft: LibraryDraft, assets?: readonly StoredMediaAsset[]) => void;
  readonly onDiscardDraft?: (key: string) => void;
  readonly onFlag?: (id: string) => void;
  readonly onSelectDeck?: (id: string) => void;
  readonly onGenerateCards?: () => void;
  readonly onStudy?: (areaId: string) => void;
  readonly onImportCards?: () => void;
  readonly now?: number;
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
  notes = emptyLibraryNotes,
  flaggedOnly: requestedFlaggedOnly,
  onFlaggedFilterChange,
  notesLoaded = true,
  onRetainDraft,
  onFlushDraft,
  onDiscardDraft,
  onFlag,
  onSelectDeck,
  now: currentTime,
  onGenerateCards,
  onStudy,
  onImportCards,
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
  const [initialTime] = useState(() => Date.now());
  const now = currentTime ?? initialTime;
  const [creationChoices, setCreationChoices] = useState(false);
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
      ...(card ? { sourceCard: card } : {}),
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
  const [pendingOpen, setPendingOpen] = useState<{ readonly next: Editor | null } | null>(null);
  const [selectedCards, setSelectedCards] = useState<readonly string[]>([]);
  const [selectionAreaId, setSelectionAreaId] = useState(area?.id ?? "");
  const [localFlaggedOnly, setLocalFlaggedOnly] = useState(false);
  const flaggedOnly = requestedFlaggedOnly ?? localFlaggedOnly;
  function setFlaggedOnly(value: boolean) {
    setLocalFlaggedOnly(value);
    onFlaggedFilterChange?.(value);
  }
  const [bulkAction, setBulkAction] = useState<"tags" | "move" | "delete" | null>(null);
  const [bulkTags, setBulkTags] = useState("");
  const [bulkDestination, setBulkDestination] = useState("");
  const [bulkRequest, setBulkRequest] = useState<{
    readonly command: unknown;
    readonly baseline?: string;
  } | null>(null);
  const bulkSnapshot = useRef(workspace);
  const selectedIds =
    selectionAreaId === area?.id
      ? selectedCards.filter((id) => area.cards.some((card) => card.id === id))
      : [];
  const snapshotDraft = useCallback((): LibraryDraft | null => {
    if (editor?.kind === "area") {
      if (editor.mode === "create" && !editor.title.trim()) return null;
      const saved = workspace?.areas.find((item) => item.id === editor.id);
      if (editor.mode === "edit" && saved?.title === editor.title && saved.color === editor.color)
        return null;
      return {
        kind: "area",
        key: editor.mode === "edit" ? `area:${editor.id}` : "new-area",
        id: editor.id,
        mode: editor.mode,
        title: editor.title,
        color: editor.color,
        ...(editor.baseline === undefined ? {} : { baseline: editor.baseline }),
      };
    }
    if (editor?.kind !== "card") return null;
    const content = editor.content;
    if (
      editor.mode === "create" &&
      !(
        content.front.trim() ||
        content.back.trim() ||
        content.cloze?.text.trim() ||
        editor.tagsText.trim() ||
        content.media.length
      )
    )
      return null;
    const source = editor.sourceCard;
    if (
      source &&
      (source.cloze ? "cloze" : "basic") === content.kind &&
      source.front === content.front &&
      source.back === content.back &&
      (source.cloze?.text ?? "") === (content.cloze?.text ?? "") &&
      (source.cloze?.deletionIndex ?? 1) === (content.cloze?.deletionIndex ?? 1) &&
      formatTagInput(source.tags ?? []) === editor.tagsText &&
      JSON.stringify(source.media ?? []) === JSON.stringify(content.media) &&
      JSON.stringify(source.objectiveIds ?? []) === JSON.stringify(content.objectiveIds)
    )
      return null;
    return {
      kind: "card",
      key: editor.mode === "edit" ? `card:${editor.id}` : `new-card:${editor.areaId}`,
      areaId: editor.areaId,
      id: editor.id,
      mode: editor.mode,
      cardKind: content.kind,
      front: content.front,
      back: content.back,
      clozeText: content.cloze?.text ?? "",
      clozeIndex: String(content.cloze?.deletionIndex ?? 1),
      tagsText: editor.tagsText,
      objectiveIds: content.objectiveIds,
      media: content.media,
      removedMediaIds: [],
      ...(source ? { sourceCard: source } : {}),
      ...(editor.baseline === undefined ? {} : { baseline: editor.baseline }),
    };
  }, [editor, workspace]);

  function retainCurrentDraft() {
    const draft = snapshotDraft();
    if (draft) onRetainDraft?.(draft, editor?.kind === "card" ? editor.stagedAssets : []);
  }
  useEffect(() => {
    if (!notesLoaded || !onRetainDraft || !editor) return;
    const timer = setTimeout(() => {
      const draft = snapshotDraft();
      if (draft) onRetainDraft(draft, editor.kind === "card" ? editor.stagedAssets : []);
    }, 350);
    return () => clearTimeout(timer);
  }, [snapshotDraft, editor, onRetainDraft, notesLoaded]);
  async function keepDraftAndClose() {
    const request = pendingOpen;
    if (!request) return;
    retainCurrentDraft();
    if (onFlushDraft && !(await onFlushDraft())) {
      setMessage(
        "The draft couldn’t be saved. Keep editing here or retry draft saving before closing.",
      );
      return;
    }
    setPendingOpen(null);
    openDirectly(request.next);
  }
  function resumeDraft(draft: LibraryDraft) {
    if (draft.kind === "area") {
      open({
        kind: "area",
        mode: draft.mode,
        id: draft.id,
        title: draft.title,
        color: draft.color,
        ...(draft.baseline === undefined ? {} : { baseline: draft.baseline }),
      });
      return;
    }
    if (!workspace?.areas.some((item) => item.id === draft.areaId)) {
      setMessage(
        `The draft’s deck no longer exists. Copy the text before discarding: ${draft.front || draft.clozeText} — ${draft.back}`,
      );
      return;
    }
    onSelectDeck?.(draft.areaId);
    const tags = parseTagInput(draft.tagsText);
    open({
      kind: "card",
      mode: draft.mode,
      id: draft.id,
      areaId: draft.areaId,
      tagsText: draft.tagsText,
      stagedAssets: [],
      ...(draft.sourceCard ? { sourceCard: draft.sourceCard } : {}),
      content: {
        kind: draft.cardKind,
        front: draft.front,
        back: draft.back,
        ...(draft.cardKind === "cloze"
          ? { cloze: { text: draft.clozeText, deletionIndex: Number(draft.clozeIndex) } }
          : {}),
        objectiveIds: draft.objectiveIds.map(createObjectiveId),
        media: draft.media,
        tags: Either.isRight(tags) ? tags.right : [],
      },
      ...(draft.baseline === undefined ? {} : { baseline: draft.baseline }),
    });
  }
  const locked = disabled || pending || picking;
  function open(next: Editor | null) {
    if (locked) return;
    if (bulkAction) {
      setMessage("Finish or cancel the bulk action before opening an editor.");
      return;
    }
    if (snapshotDraft()) {
      retainCurrentDraft();
      setPendingOpen({ next });
      return;
    }
    openDirectly(next);
  }
  function openDirectly(next: Editor | null) {
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
  function beginBulk(action: "tags" | "move" | "delete") {
    if (editor) {
      setMessage("Keep, save, or close the editor before changing selected cards.");
      return;
    }
    setBulkAction(action);
    setBulkRequest(null);
    setMessage(null);
    bulkSnapshot.current = workspace;
    if (action === "delete" && area) {
      const command = { kind: "bulk-delete-cards", areaId: area.id, cardIds: selectedIds };
      setBulkRequest({ command, ...bound(command) });
    }
  }
  function submitBulk() {
    if (!area || !workspace || locked) return;
    if (selectionAreaId !== area.id || selectedIds.length === 0) {
      setMessage(
        "Return to the original deck or cancel this bulk action before starting another selection.",
      );
      return;
    }
    let request = bulkRequest;
    if (!request) {
      let command: unknown;
      if (bulkAction === "tags") {
        const tags = parseTagInput(bulkTags);
        if (Either.isLeft(tags) || (Either.isRight(tags) && tags.right.length === 0)) {
          setMessage(Either.isLeft(tags) ? tags.left.message : "Enter at least one tag.");
          return;
        }
        command = {
          kind: "bulk-tag-cards",
          areaId: area.id,
          cardIds: selectedIds,
          tags: tags.right,
        };
      } else if (bulkAction === "move") {
        if (!bulkDestination) {
          setMessage("Choose a destination deck.");
          return;
        }
        command = {
          kind: "bulk-move-cards",
          areaId: area.id,
          targetAreaId: bulkDestination,
          cards: selectedIds.map((id) => ({ cardId: id, newCardId: createId() })),
        };
      } else return;
      const decoded = Schema.decodeUnknownEither(WorkspaceAuthoringCommandSchema)(command);
      if (Either.isLeft(decoded)) {
        setMessage("The selected action could not be validated.");
        return;
      }
      const baselineValue = bulkSnapshot.current
        ? workspaceAuthoringBaseline(bulkSnapshot.current, decoded.right)
        : undefined;
      request = {
        command: decoded.right,
        ...(baselineValue === undefined ? {} : { baseline: baselineValue }),
      };
      setBulkRequest(request);
    }
    submit(request.command, request.baseline);
  }
  function submit(command: unknown, expectedBaseline?: string, continueAdding = false) {
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
              setPendingOpen(null);
              const draft = snapshotDraft();
              if (draft) onDiscardDraft?.(draft.key);
              if (bulkAction) {
                setBulkAction(null);
                setSelectedCards([]);
                setBulkRequest(null);
              }
              if (editor?.kind === "area" && editor.mode === "create") setCreationChoices(true);
              if (continueAdding && editor?.kind === "card" && editor.mode === "create") {
                editorGeneration.current += 1;
                setKeptDuplicateDraft(null);
                setShowCardDetails(false);
                setRefinementDuplicate(null);
                setEditor({
                  kind: "card",
                  mode: "create",
                  areaId: editor.areaId,
                  id: createId(),
                  stagedAssets: [],
                  tagsText: "",
                  content: {
                    ...emptyContent,
                    kind: editor.content.kind,
                    ...(editor.content.kind === "cloze"
                      ? { cloze: { text: "", deletionIndex: 1 } }
                      : {}),
                  },
                });
                setMessage("Card saved. Add your next card.");
              } else setEditor(null);
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
  function saveCard(continueAdding: boolean) {
    if (editor?.kind !== "card") return;
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
      continueAdding,
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
        key={editor?.kind === "card" ? `${editor.id}:${label}` : label}
        autoFocus={
          editor?.kind === "card" &&
          editor.mode === "create" &&
          (label === "Question" || label === "Cloze text")
        }
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
  const clozePreview =
    editor?.kind === "card" && editor.content.kind === "cloze"
      ? Effect.runSync(
          Effect.either(
            renderClozeCard(
              editor.content.cloze?.text ?? "",
              editor.content.cloze?.deletionIndex ?? 1,
            ),
          ),
        )
      : null;
  const assistanceContent: CardProposal | null =
    editor?.kind === "card" &&
    (editor.content.kind === "basic"
      ? Boolean(editor.content.front.trim() && editor.content.back.trim())
      : Boolean(clozePreview && Either.isRight(clozePreview)))
      ? {
          front:
            editor.content.kind === "cloze"
              ? (editor.content.cloze?.text ?? "")
              : editor.content.front,
          back:
            clozePreview && Either.isRight(clozePreview)
              ? clozePreview.right.back
              : editor.content.back,
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
      return (
        matchesSearch &&
        matchesObjective &&
        (!flaggedOnly || notes.flaggedCardIds.includes(card.id))
      );
    }) ?? [];
  return (
    <View className={"gap-[12px]"} testID="native-workspace-authoring">
      {pendingOpen && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">Keep this draft?</Text>
          <Text>
            Your edits haven’t been saved as a card or deck. Keep the draft to resume later, or
            discard it.
          </Text>
          <NativeButton label="Continue editing" tone="soft" onPress={() => setPendingOpen(null)} />
          {onRetainDraft && (
            <NativeButton
              label="Keep draft and close"
              disabled={!notesLoaded}
              onPress={() => void keepDraftAndClose()}
            />
          )}
          <NativeButton
            label="Discard draft"
            tone="soft"
            onPress={() => {
              const draft = snapshotDraft();
              if (draft) onDiscardDraft?.(draft.key);
              const next = pendingOpen.next;
              setPendingOpen(null);
              openDirectly(next);
            }}
          />
        </View>
      )}
      {notes.drafts.length > 0 && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">Resume a draft</Text>
          {notes.drafts.map((draft) => (
            <View key={draft.key} className="gap-2">
              <NativeButton
                label={
                  draft.kind === "area"
                    ? `Deck: ${draft.title || "Untitled"}`
                    : `Card: ${draft.front || draft.clozeText || "Untitled"}`
                }
                tone="soft"
                disabled={locked}
                onPress={() => resumeDraft(draft)}
              />
              <Text selectable className="text-sm text-recall-muted">
                {draft.kind === "card"
                  ? `${draft.front || draft.clozeText} — ${draft.back}`
                  : draft.title}
              </Text>
            </View>
          ))}
        </View>
      )}
      {onSelectDeck && workspace && (
        <View className="gap-3">
          <Text className="text-lg font-bold">Your decks</Text>
          {workspace.areas.map((deck) => {
            const summary = summarizeStudySession(deck, [], now);
            return (
              <View key={deck.id} className="gap-2 rounded-xl border border-recall-line p-4">
                <Text className="text-base font-bold">{deck.title}</Text>
                <Text className="text-sm text-recall-muted">
                  {deck.cards.length} {deck.cards.length === 1 ? "card" : "cards"} ·{" "}
                  {summary.remaining} due
                </Text>
                <Text className="text-sm text-recall-muted">
                  {summary.remaining
                    ? "Ready to review"
                    : summary.nextReviewAt
                      ? `Next review: ${new Date(summary.nextReviewAt).toLocaleString()}`
                      : "Add cards to get started"}
                </Text>
                <NativeButton
                  label="Open deck"
                  tone="soft"
                  disabled={locked}
                  onPress={() => {
                    retainCurrentDraft();
                    onSelectDeck(deck.id);
                  }}
                />
                {onStudy && (
                  <NativeButton
                    label={`Review ${summary.remaining} due`}
                    disabled={locked || summary.remaining === 0}
                    onPress={() => {
                      retainCurrentDraft();
                      onStudy(deck.id);
                    }}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
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
          label="New deck"
          tone="soft"
          disabled={locked}
          onPress={() => open(areaEditor("create"))}
        />
      }
      {onImportCards && (
        <NativeButton label="Import cards" tone="soft" disabled={locked} onPress={onImportCards} />
      )}
      {creationChoices && area && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold text-recall-ink">Add cards to {area.title}</Text>
          <Text className="text-sm text-recall-muted">
            Write cards, generate suggestions from materials, or import an existing deck. AI
            suggestions need your approval.
          </Text>
          <NativeButton
            label="Write manually"
            disabled={locked}
            onPress={() => {
              setCreationChoices(false);
              open(cardEditor());
            }}
          />
          {onGenerateCards && (
            <NativeButton
              label="Generate from materials"
              tone="soft"
              disabled={locked}
              onPress={() => {
                setCreationChoices(false);
                onGenerateCards();
              }}
            />
          )}
          {onImportCards && (
            <NativeButton
              label="Import existing cards"
              tone="soft"
              disabled={locked}
              onPress={() => {
                setCreationChoices(false);
                onImportCards();
              }}
            />
          )}
          <NativeButton
            label="Finish later"
            tone="soft"
            disabled={locked}
            onPress={() => setCreationChoices(false)}
          />
        </View>
      )}
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
                  sourceCard: card,
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
              accessibilityLabel="Deck actions"
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
                label="Deck settings"
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
                label="Delete deck"
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
          {onGenerateCards && (
            <NativeButton
              label="Generate cards"
              tone="soft"
              disabled={locked}
              onPress={onGenerateCards}
            />
          )}
          {onStudy && (
            <NativeButton
              label={`Review ${area.cards.filter((card) => Date.parse(card.schedule.due) <= now).length} due cards`}
              disabled={locked || !area.cards.some((card) => Date.parse(card.schedule.due) <= now)}
              onPress={() => onStudy(area.id)}
            />
          )}
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
            {editor.mode === "create" ? "New deck" : "Edit deck"}
          </Text>
          {field("Deck name", editor.title, (title) => setEditor({ ...editor, title }), false, 80)}
          {field(
            "Color (optional, #RRGGBB)",
            editor.color,
            (color) => setEditor({ ...editor, color }),
            false,
            7,
          )}
          {
            <NativeButton
              label={
                pending ? "Saving…" : editor.mode === "create" ? "Create deck" : "Save changes"
              }
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
          {editor.mode === "create" && (
            <NativeButton
              label="Save and add another"
              disabled={locked}
              onPress={() => saveCard(true)}
            />
          )}
          <NativeButton
            label={
              pending ? "Saving…" : editor.mode === "create" ? "Save and finish" : "Save changes"
            }
            tone="soft"
            disabled={locked}
            onPress={() => saveCard(false)}
          />
        </View>
      )}
      {editor?.kind === "settings" && (
        <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
          <Text className={"text-recall-ink text-[16px] font-bold"}>
            Deck settings and objectives
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
            "Deck tags (comma separated)",
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
          {onFlag && (
            <NativeButton
              label={
                flaggedOnly
                  ? "Show all cards"
                  : `Flagged for editing (${area.cards.filter((card) => notes.flaggedCardIds.includes(card.id)).length})`
              }
              tone="soft"
              onPress={() => setFlaggedOnly(!flaggedOnly)}
            />
          )}
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

          <View className="gap-2">
            <NativeButton
              label="Select visible cards"
              tone="soft"
              disabled={locked || bulkAction !== null || filteredCards.length === 0}
              onPress={() => {
                setSelectionAreaId(area.id);
                setSelectedCards([
                  ...new Set([...selectedIds, ...filteredCards.map((card) => card.id)]),
                ]);
              }}
            />
            <Text accessibilityLiveRegion="polite">{selectedIds.length} selected</Text>
            {selectedIds.length > 0 && (
              <>
                <NativeButton
                  label="Add tags"
                  tone="soft"
                  disabled={locked}
                  onPress={() => beginBulk("tags")}
                />
                <NativeButton
                  label="Move cards"
                  tone="soft"
                  disabled={locked || (workspace?.areas.length ?? 0) < 2}
                  onPress={() => beginBulk("move")}
                />
                <NativeButton
                  label="Delete selected"
                  tone="soft"
                  disabled={locked}
                  onPress={() => beginBulk("delete")}
                />
                <NativeButton
                  label="Clear selection"
                  tone="soft"
                  disabled={locked || bulkAction !== null}
                  onPress={() => setSelectedCards([])}
                />
              </>
            )}
          </View>
          {bulkAction && (
            <View className="gap-3 rounded-xl border border-recall-line p-4">
              <Text className="text-lg font-bold">
                {bulkAction === "tags"
                  ? "Add tags"
                  : bulkAction === "move"
                    ? "Move selected cards"
                    : "Delete selected cards"}
              </Text>
              <Text>
                {selectedIds.length} selected.{" "}
                {bulkAction === "move"
                  ? "Cards receive fresh schedules in the destination. Original reviews stay in Deleted cards. Matching objectives are linked by title; tags and attachments are retained."
                  : bulkAction === "delete"
                    ? "History is preserved. Recover cards from Deleted cards."
                    : "Tags are added without changing review schedules."}
              </Text>
              {bulkAction === "tags" &&
                field("Tags (comma separated)", bulkTags, (value) => {
                  if (!bulkRequest) setBulkTags(value);
                })}
              {bulkAction === "move" &&
                workspace?.areas
                  .filter((deck) => deck.id !== area.id)
                  .map((deck) => (
                    <NativeButton
                      key={deck.id}
                      label={`${bulkDestination === deck.id ? "Selected: " : ""}${deck.title}`}
                      tone="soft"
                      disabled={locked || Boolean(bulkRequest)}
                      onPress={() => setBulkDestination(deck.id)}
                    />
                  ))}
              <NativeButton
                label={
                  pending
                    ? "Saving selection…"
                    : bulkRequest
                      ? "Retry selection"
                      : bulkAction === "delete"
                        ? "Confirm deletion"
                        : bulkAction === "move"
                          ? "Confirm move"
                          : "Save tags"
                }
                disabled={locked}
                onPress={submitBulk}
              />
              {message && (
                <Text accessibilityRole="alert" className="text-sm text-recall-muted">
                  {message}
                </Text>
              )}
              <NativeButton
                label="Cancel bulk action"
                tone="soft"
                disabled={pending}
                onPress={() => {
                  setBulkAction(null);
                  setBulkRequest(null);
                }}
              />
            </View>
          )}
          {filteredCards.map((card) => (
            <View key={card.id} className={"border-t border-recall-line py-[8px]"}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`Select card: ${card.front}`}
                accessibilityState={{
                  checked: selectedIds.includes(card.id),
                  disabled: locked || bulkAction !== null,
                }}
                disabled={locked || bulkAction !== null}
                onPress={() => {
                  setSelectionAreaId(area.id);
                  setSelectedCards(
                    selectedIds.includes(card.id)
                      ? selectedIds.filter((id) => id !== card.id)
                      : [...selectedIds, card.id],
                  );
                }}
                className="min-h-12 justify-center"
              >
                <Text>
                  {selectedIds.includes(card.id) ? "☑ Selected" : "☐ Select card"}
                  {notes.flaggedCardIds.includes(card.id) ? " · Flagged for editing" : ""}
                </Text>
              </Pressable>
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
                  {onFlag && (
                    <NativeButton
                      label={
                        notes.flaggedCardIds.includes(card.id)
                          ? "Remove editing flag"
                          : "Improve later"
                      }
                      tone="soft"
                      disabled={locked}
                      onPress={() => onFlag(card.id)}
                    />
                  )}
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
