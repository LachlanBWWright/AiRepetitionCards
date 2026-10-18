import { NativeButton } from "../../ui/NativeButton";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import { createObjectiveId, type KnowledgeArea } from "@recall/domain";
import {
  addNotebookConcepts,
  removeNotebookMaterial,
  type KnowledgeNotebook,
  type WorkspaceSearchTarget,
} from "@recall/application";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";
import {
  NativeStudyMaterialsPanelIntake,
  type NativeStudyMaterialsExtraction,
} from "./NativeStudyMaterialsPanel.intake";
import { generateNativeStudyMaterialBatch } from "./NativeStudyMaterialsPanel.generate";
import { useNativeStudyMaterialsSelectionState } from "./NativeStudyMaterialsPanel.selection-state";
import { useNativeStudyMaterialsGenerationState } from "./NativeStudyMaterialsPanel.generation-state";
import {
  NativeStudyMaterialsPanelGenerationActions,
  NativeStudyMaterialsPanelGenerationSettings,
  NativeStudyMaterialsPanelClaimControls,
  NativeStudyMaterialsPanelMetadata,
  NativeStudyMaterialsPanelPassage,
  NativeStudyMaterialsPanelRemove,
  NativeStudyMaterialsPanelSuggestions,
} from "./NativeStudyMaterialsPanel.Material";
import { NativeStudyMaterialsPanelClaims } from "./NativeStudyMaterialsPanelClaims";
import { NativeStudyMaterialsPanelSearchResult } from "./NativeStudyMaterialsPanel.SearchResult";
import { NativeStudyMaterialsPanelPreview } from "./NativeStudyMaterialsPanel.Preview";
import {
  createNativeStudyMaterialsPanelActions,
  getNativeStudyMaterialCoverage,
} from "./NativeStudyMaterialsPanel.actions";

type TutorApi = ReturnType<typeof makeNativeTutorApi>;
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
  const selection = useNativeStudyMaterialsSelectionState(searchTarget);
  const generation = useNativeStudyMaterialsGenerationState();
  const {
    selectedId,
    setSelectedId,
    showPassage,
    setShowPassage,
    sectionId,
    setSectionId,
    passageDraft,
    setPassageDraft,
    expandedClaimId,
    setExpandedClaimId,
    targetClaimId,
    setTargetClaimId,
  } = selection;
  const {
    conceptId,
    setConceptId,
    depth,
    setDepth,
    count,
    setCount,
    showGenerationSettings,
    setShowGenerationSettings,
  } = generation;
  const [preview, setPreview] = useState<{
    readonly name: string;
    readonly extraction: NativeStudyMaterialsExtraction;
  } | null>(null);
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
  const { coverage, claimCoverage } = getNativeStudyMaterialCoverage(notebook);
  const plans = notebook?.coveragePlans?.filter((plan) => plan.materialId === material?.id) ?? [];

  const { planSection, changeClaim, importPreview, updateMaterial } =
    createNativeStudyMaterialsPanelActions({
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
      hasUnsavedPassage: hasUnsavedPassage === true,
      passageDraft,
      setNotice,
      setSelectedId,
      setSectionId,
      setPreview,
      setPassageDraft,
    });

  async function generate() {
    await generateNativeStudyMaterialBatch({
      notebook,
      material,
      api,
      area,
      count,
      conceptId,
      depth,
      hasUnsavedPassage: hasUnsavedPassage === true,
      targetClaimId,
      pause,
      persistBeforeRequest,
      runAction,
      save,
      setNotice,
      setGenerating,
      setSuggestions,
    });
  }

  function addSuggestion(suggestion: { readonly title: string; readonly description: string }) {
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
        setSuggestions((current) => current.filter((item) => item.title !== suggestion.title));
    });
  }

  async function removeMaterial() {
    if (!notebook || !material) return;
    await runAction(async (isCurrent) => {
      const result = Effect.runSync(Effect.either(removeNotebookMaterial(notebook, material.id)));
      if (!isCurrent()) return;
      if (Either.isLeft(result)) setNotice(result.left.message);
      else await save(result.right);
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
        <NativeStudyMaterialsPanelSearchResult
          materialName={searchedMaterial.name}
          passageTitle={searchedPassage?.title ?? null}
          passageText={searchedPassage?.text ?? null}
          claimTitle={searchedClaim?.title ?? null}
        />
      ) : null}
      {button(showAdd ? "Close import" : "Add material", () => {
        setShowAdd((current) => !current);
      })}
      <View className={showAdd || !notebook?.materials?.length ? "gap-[10px]" : "hidden"}>
        <NativeStudyMaterialsPanelIntake
          disabled={disabled}
          runAction={runAction}
          onPreview={(previewName, extraction) => {
            setPreview({ name: previewName, extraction });
          }}
          onNotice={setNotice}
        />
      </View>
      {preview ? (
        <NativeStudyMaterialsPanelPreview
          name={preview.name}
          extraction={preview.extraction}
          onImport={() => void importPreview(preview)}
          onCancel={() => {
            setPreview(null);
          }}
        />
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
          <NativeStudyMaterialsPanelMetadata
            material={material}
            coverage={coverage}
            disabled={disabled}
            onUpdate={updateMaterial}
            onEditPassage={(id) => {
              setSectionId(id);
              setShowPassage(true);
            }}
          />
          <NativeStudyMaterialsPanelPassage
            material={material}
            section={section}
            visible={showPassage}
            disabled={disabled}
            text={editedText}
            onClose={() => {
              setShowPassage(false);
            }}
            onTextChange={(text) => {
              if (section) setPassageDraft({ sectionId: section.id, text });
            }}
            onSave={updateMaterial}
          />
          <View className="gap-[8px]">
            <Text className="text-recall-ink text-[14px] font-bold">Choose topics</Text>
            <NativeStudyMaterialsPanelClaimControls
              disabled={disabled}
              planDisabled={disabled || !api || hasUnsavedPassage === true || !section}
              onPlan={() => void planSection()}
              onClearTarget={() => {
                setTargetClaimId(null);
              }}
            />
            <NativeStudyMaterialsPanelClaims
              plans={plans}
              sections={material.sections}
              coverage={claimCoverage}
              expandedClaimId={expandedClaimId}
              targetClaimId={targetClaimId}
              disabled={disabled}
              onToggleClaim={(claimId) => {
                setExpandedClaimId((current) => (current === claimId ? null : claimId));
              }}
              onChangeClaim={(planId, claimId, decision, priority) =>
                void changeClaim(planId, claimId, decision, priority)
              }
              onFocusClaim={setTargetClaimId}
            />
          </View>
          <NativeStudyMaterialsPanelSuggestions
            suggestions={suggestions}
            disabled={disabled}
            onAdd={addSuggestion}
          />
          <NativeStudyMaterialsPanelGenerationSettings
            notebook={notebook}
            conceptId={conceptId}
            depth={depth}
            count={count}
            visible={showGenerationSettings}
            disabled={disabled}
            onConceptChange={setConceptId}
            onDepthChange={setDepth}
            onCountChange={setCount}
            onToggle={() => {
              setShowGenerationSettings((current) => !current);
            }}
          />
          <NativeStudyMaterialsPanelGenerationActions
            disabled={disabled}
            hasApi={api !== null}
            hasUnsavedPassage={hasUnsavedPassage === true}
            generating={generating}
            onGenerate={() => void generate()}
            onPause={() => {
              pause.current = true;
            }}
          />
          <NativeStudyMaterialsPanelRemove
            disabled={disabled}
            onRemove={() => void removeMaterial()}
          />
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
