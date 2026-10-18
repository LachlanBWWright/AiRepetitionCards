import { Text, TextInput, View } from "react-native";
import type { KnowledgeNotebook, StudyMaterial } from "@recall/application";
import type { getNativeStudyMaterialCoverage } from "./NativeStudyMaterialsPanel.actions";
import { toggleNativeStudyMaterialSectionSelection } from "./NativeStudyMaterialsPanel.material-model";
import { NativeButton } from "../../ui/NativeButton";

type Coverage = ReturnType<typeof getNativeStudyMaterialCoverage>["coverage"];
type Suggestion = { readonly title: string; readonly description: string };
type Section = StudyMaterial["sections"][number];

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
}) {
  return (
    <NativeButton
      label={label}
      onPress={onPress}
      disabled={disabled}
      className="py-[10px] px-[4px]"
      labelClassName="text-recall-surface text-[12px] font-bold"
    />
  );
}

export function NativeStudyMaterialsPanelMetadata({
  material,
  coverage,
  disabled,
  onUpdate,
  onEditPassage,
}: {
  readonly material: StudyMaterial;
  readonly coverage: Coverage;
  readonly disabled: boolean;
  readonly onUpdate: (next: StudyMaterial) => Promise<void>;
  readonly onEditPassage: (sectionId: string) => void;
}) {
  const toggleSelection = (id: string) => () => {
    void onUpdate(toggleNativeStudyMaterialSectionSelection(material, id));
  };
  const editPassage = (id: string) => () => {
    onEditPassage(id);
  };
  return (
    <>
      <Text className="text-recall-ink text-[14px] font-bold">{material.name}</Text>
      {material.warnings.map((warning, index) => (
        <Text key={index} className="text-recall-muted text-[11px] leading-[16px]">
          {warning}
        </Text>
      ))}
      {material.sections.map((item) => {
        const progress = coverage.find(
          (entry) => entry.sectionId === item.id && entry.materialId === material.id,
        );
        return (
          <View key={item.id} className="gap-[5px] border-b border-b-recall-line pb-[8px]">
            <Text className="text-recall-ink text-[12px] leading-[18px]">
              {item.title}
              {item.pageNumber ? ` · page ${String(item.pageNumber)}` : ""} ·{" "}
              {progress?.status ?? "unprocessed"} · {progress?.pendingCards ?? 0} pending ·{" "}
              {progress?.approvedCards ?? 0} approved
            </Text>
            <View className="flex-row flex-wrap gap-[7px]">
              <ActionButton
                label={item.selected ? "✓ Selected" : "Select"}
                disabled={disabled}
                onPress={toggleSelection(item.id)}
              />
              <ActionButton label="Check text" disabled={disabled} onPress={editPassage(item.id)} />
            </View>
          </View>
        );
      })}
    </>
  );
}

export function NativeStudyMaterialsPanelPassage({
  material,
  section,
  visible,
  disabled,
  text,
  onClose,
  onTextChange,
  onSave,
}: {
  readonly material: StudyMaterial;
  readonly section: Section | undefined;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly text: string;
  readonly onClose: () => void;
  readonly onTextChange: (text: string) => void;
  readonly onSave: (next: StudyMaterial) => Promise<void>;
}) {
  if (!visible || !section) return null;
  return (
    <>
      <Text className="text-recall-ink text-[14px] font-bold">{section.title}</Text>
      <ActionButton label="Close text" disabled={disabled} onPress={onClose} />
      <TextInput
        accessibilityLabel="Correct extracted passage"
        multiline
        value={text}
        onChangeText={onTextChange}
        maxLength={12000}
        className="p-[10px] rounded-[8px] bg-recall-paper text-recall-ink min-h-[120px] max-h-[260px]"
      />
      <ActionButton
        label="Save passage correction"
        disabled={disabled}
        onPress={() =>
          void onSave({
            ...material,
            sections: material.sections.map((entry) =>
              entry.id === section.id ? { ...entry, text } : entry,
            ),
          })
        }
      />
    </>
  );
}

export function NativeStudyMaterialsPanelSuggestions({
  suggestions,
  disabled,
  onAdd,
}: {
  readonly suggestions: readonly Suggestion[];
  readonly disabled: boolean;
  readonly onAdd: (suggestion: Suggestion) => void;
}) {
  return (
    <>
      {suggestions.map((suggestion) => (
        <View key={suggestion.title} className="gap-[5px] border-b border-b-recall-line pb-[8px]">
          <Text className="text-recall-ink text-[14px] font-bold">
            Suggested concept: {suggestion.title}
          </Text>
          <Text className="text-recall-muted text-[11px] leading-[16px]">
            {suggestion.description}
          </Text>
          <ActionButton
            label="Add suggested concept"
            disabled={disabled}
            onPress={() => {
              onAdd(suggestion);
            }}
          />
        </View>
      ))}
    </>
  );
}

export function NativeStudyMaterialsPanelClaimControls({
  disabled,
  planDisabled,
  onPlan,
  onClearTarget,
}: {
  readonly disabled: boolean;
  readonly planDisabled: boolean;
  readonly onPlan: () => void;
  readonly onClearTarget: () => void;
}) {
  return (
    <>
      <ActionButton
        label="Suggest topics for this passage"
        onPress={onPlan}
        disabled={planDisabled}
      />
      <ActionButton label="Use all selected passages" onPress={onClearTarget} disabled={disabled} />
    </>
  );
}

export type NativeStudyMaterialsGenerationDepth = "overview" | "standard" | "detailed";
export function NativeStudyMaterialsPanelGenerationSettings({
  notebook,
  conceptId,
  depth,
  count,
  visible,
  disabled,
  onConceptChange,
  onDepthChange,
  onCountChange,
  onToggle,
}: {
  readonly notebook: KnowledgeNotebook | null;
  readonly conceptId: string | null;
  readonly depth: NativeStudyMaterialsGenerationDepth;
  readonly count: string;
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly onConceptChange: (id: string) => void;
  readonly onDepthChange: (depth: NativeStudyMaterialsGenerationDepth) => void;
  readonly onCountChange: (count: string) => void;
  readonly onToggle: () => void;
}) {
  const button = (label: string, onPress: () => void) => (
    <ActionButton key={label} label={label} onPress={onPress} disabled={disabled} />
  );
  return (
    <>
      {button(visible ? "Hide options" : "Options", onToggle)}
      <View className={visible ? "gap-[10px]" : "hidden"}>
        <Text className="text-recall-muted text-[11px] leading-[16px]">
          Choose the concept these proposals will investigate.
        </Text>
        <View className="flex-row flex-wrap gap-[7px]">
          {notebook?.concepts.map((concept) =>
            button(
              `${(conceptId ?? notebook.concepts[0]?.id) === concept.id ? "✓ " : ""}${concept.title}`,
              () => {
                onConceptChange(concept.id);
              },
            ),
          )}
        </View>
        <View className="flex-row flex-wrap gap-[7px]">
          {(["overview", "standard", "detailed"] as const).map((value) =>
            button(`${depth === value ? "✓ " : ""}${value}`, () => {
              onDepthChange(value);
            }),
          )}
        </View>
        <Text className="text-recall-muted text-[11px] leading-[16px]">Number of cards</Text>
        <TextInput
          accessibilityLabel="Cards per material batch"
          value={count}
          onChangeText={onCountChange}
          keyboardType="number-pad"
          className="p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"
        />
      </View>
    </>
  );
}

export function NativeStudyMaterialsPanelGenerationActions({
  disabled,
  hasApi,
  hasUnsavedPassage,
  generating,
  onGenerate,
  onPause,
}: {
  readonly disabled: boolean;
  readonly hasApi: boolean;
  readonly hasUnsavedPassage: boolean;
  readonly generating: boolean;
  readonly onGenerate: () => void;
  readonly onPause: () => void;
}) {
  return (
    <>
      <Text className="text-recall-ink text-[14px] font-bold">Generate cards</Text>
      <Text className="text-recall-muted text-[11px] leading-[16px]">
        Selected text is sent to AI when you generate cards.
      </Text>
      <NativeButton
        label="Generate cards"
        onPress={onGenerate}
        disabled={disabled || !hasApi || hasUnsavedPassage}
        className="py-[10px] px-[4px]"
        labelClassName="text-recall-surface text-[12px] font-bold"
      />
      {generating ? (
        <NativeButton
          label="Pause generation"
          onPress={onPause}
          className="py-[10px] px-[4px]"
          labelClassName="text-recall-surface text-[12px] font-bold"
        />
      ) : null}
      {!hasApi ? (
        <Text className="text-recall-muted text-[11px] leading-[16px]">
          Connect AI in settings to generate cards.
        </Text>
      ) : null}
    </>
  );
}

export function NativeStudyMaterialsPanelRemove({
  disabled,
  onRemove,
}: {
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  return <ActionButton label="Remove material" disabled={disabled} onPress={onRemove} />;
}
