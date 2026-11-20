import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";
import { useState } from "react";
import { NativeProposedCardPreview } from "./NativeProposedCardPreview";
import { NativeKnowledgeNotebookSources } from "../NativeKnowledgeNotebookSources";
import { NativeButton } from "../../../ui/NativeButton";
import { Text, TextInput, View } from "react-native";
import { NativeProposalDuplicateWarning } from "./NativeProposalDuplicateWarning";
import { NativeCardAssistancePanel } from "../../assistance/NativeCardAssistancePanel";
import { NotebookSection } from "../NativeKnowledgeNotebookTypes";
import type { NativeNotebookModel } from "../useNativeKnowledgeNotebookModel";
export function NativeKnowledgeNotebookProposal({
  model,
  preview = false,
}: {
  readonly model: NativeNotebookModel;
  readonly preview?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const {
    section,
    pendingProposal,
    showSources,
    setShowSources,
    notebook,
    proposalContent,
    setProposalDraft,
    busy,
    unsaved,
    mayWrite,
    api,
    refineProposal,
    inspectProposal,
    applyRefinement,
    runAction,
    saveProposalEdits,
    duplicateMatches,
    duplicateAcknowledgement,
    duplicateKey,
    setDuplicateAcknowledgement,
    duplicatesAllowed,
    resolveProposal,
  } = model;
  if (!notebook) return null;
  function updateProposal(field: "front" | "back") {
    return (value: string) => {
      if (!proposalContent || !pendingProposal) return;
      setProposalDraft({
        proposalId: pendingProposal.id,
        content: { ...proposalContent, [field]: value },
      });
    };
  }
  if (preview && !editing && pendingProposal && proposalContent)
    return (
      <NativeProposedCardPreview
        proposal={proposalContent}
        disabled={busy || !!unsaved || !mayWrite()}
        acceptDisabled={busy || !!unsaved || !mayWrite() || !duplicatesAllowed}
        onAccept={() => {
          void resolveProposal("accepted");
        }}
        onEdit={() => {
          setEditing(true);
        }}
        onDiscard={() => {
          void resolveProposal("discarded");
        }}
      >
        <NativeProposalDuplicateWarning
          matches={duplicateMatches}
          acknowledged={duplicateAcknowledgement === duplicateKey}
          disabled={busy || !!unsaved || !mayWrite()}
          onChange={(value) => {
            setDuplicateAcknowledgement(value ? duplicateKey : null);
          }}
        />
      </NativeProposedCardPreview>
    );
  return (
    <View className={section === NotebookSection.ReviewSuggestions ? "gap-[11px]" : "hidden"}>
      {preview && editing && (
        <NativeButton
          label="Done editing"
          onPress={() => {
            setEditing(false);
          }}
        />
      )}
      {!pendingProposal ? (
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
          No suggestions to review.
        </Text>
      ) : null}
      {pendingProposal ? (
        <View className={"gap-[7px] py-[12px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>Suggested card</Text>
          {pendingProposal.sourceReferences?.length ? (
            <NativeCollapsibleTrigger
              open={showSources}
              title="Sources"
              onToggle={() => {
                setShowSources((current) => !current);
              }}
            />
          ) : null}
          <NativeCollapsibleContent open={showSources}>
            {<NativeKnowledgeNotebookSources model={model} />}
          </NativeCollapsibleContent>
          <TextInput
            accessibilityLabel="Proposal question"
            value={proposalContent?.front ?? ""}
            onChangeText={updateProposal("front")}
            editable={!busy}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          <TextInput
            accessibilityLabel="Proposal answer"
            value={proposalContent?.back ?? ""}
            onChangeText={updateProposal("back")}
            editable={!busy}
            multiline
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          {proposalContent ? (
            <NativeCardAssistancePanel
              key={pendingProposal.id}
              proposalOnly
              content={proposalContent}
              disabled={busy || !!unsaved || !mayWrite()}
              onRefine={api ? refineProposal : undefined}
              onInspect={api ? inspectProposal : undefined}
              onApply={applyRefinement}
            />
          ) : null}
          <NativeButton
            disabled={busy || !!unsaved || !mayWrite()}
            onPress={() =>
              void runAction(async () => {
                await saveProposalEdits();
              })
            }
            label="Save proposal edits"
          />
          <NativeProposalDuplicateWarning
            matches={duplicateMatches}
            acknowledged={duplicateAcknowledgement === duplicateKey}
            disabled={busy || !!unsaved || !mayWrite()}
            onChange={(value) => {
              setDuplicateAcknowledgement(value ? duplicateKey : null);
            }}
          />
          <View className={"flex-row flex-wrap gap-[7px]"}>
            <NativeButton
              disabled={busy || !!unsaved || !mayWrite() || !duplicatesAllowed}
              onPress={() => void resolveProposal("accepted")}
              label="Save & approve"
            />
            <NativeButton
              variant="secondary"
              disabled={busy || !!unsaved || !mayWrite()}
              onPress={() => void resolveProposal("discarded")}
              label="Discard proposal"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
