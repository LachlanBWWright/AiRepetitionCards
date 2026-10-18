import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Text, TextInput, View } from "react-native";
import type { CardProposal, TutorSessionState } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";
import { NativeCardAssistancePanel } from "../assistance/NativeCardAssistancePanel";
import { NativeProposalDuplicateWarning } from "../notebook/proposals/NativeProposalDuplicateWarning";
import type { NativeTutorProposalWorkflowDependencies } from "./NativeTutorPanelProposalWorkflows";
import type { useNativeTutorProposalWorkflows } from "./NativeTutorPanelProposalWorkflows";
import type { findCardDuplicates } from "@recall/application";

type ProposalWorkflowActions = Pick<
  ReturnType<typeof useNativeTutorProposalWorkflows>,
  "assistProposal" | "inspectProposal" | "keepRefinement" | "resolveProposal"
>;
type DraftSetter = NativeTutorProposalWorkflowDependencies["setDraft"];

function ProposalObjectiveOptions({
  area,
  busy,
  approvalSaved,
  proposalContent,
  proposalKey,
  setDraft,
}: Pick<
  NativeTutorPanelProposalEditorProps,
  "area" | "busy" | "approvalSaved" | "proposalContent" | "proposalKey" | "setDraft"
>) {
  if (!proposalContent) return null;
  return (
    <>
      <Text className={"text-recall-ink text-[13px] leading-[19px]"}>Learning objective</Text>
      {[{ id: null, title: "No objective" }, ...area.objectives].map((objective) => (
        <NativeButton
          key={objective.id ?? "none"}
          disabled={busy || approvalSaved === true}
          label={`${proposalContent.objectiveId === objective.id ? "✓ " : ""}${objective.title}`}
          onPress={() => {
            if (proposalKey)
              setDraft({
                key: proposalKey,
                content: { ...proposalContent, objectiveId: objective.id },
              });
          }}
          className={
            "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
          }
          labelClassName="text-recall-darkGreen text-[11px] font-bold"
        />
      ))}
    </>
  );
}

export interface NativeTutorPanelProposalEditorProps extends ProposalWorkflowActions {
  readonly area: KnowledgeArea;
  readonly api: NativeTutorProposalWorkflowDependencies["api"];
  readonly busy: boolean;
  readonly mayWrite: () => boolean;
  readonly session: TutorSessionState | null;
  readonly proposalKey: string | null;
  readonly proposalContent: CardProposal | null;
  readonly approvalSaved: boolean | undefined;
  readonly editProposal: (field: "front" | "back" | "rationale", value: string) => void;
  readonly setDraft: DraftSetter;
  readonly duplicateMatches: ReturnType<typeof findCardDuplicates>;
  readonly duplicateAcknowledgement: string | null;
  readonly setDuplicateAcknowledgement: Dispatch<SetStateAction<string | null>>;
  readonly duplicateKey: string;
  readonly duplicatesAllowed: boolean;
}

export function NativeTutorPanelProposalEditor({
  area,
  api,
  busy,
  mayWrite,
  session,
  proposalKey,
  proposalContent,
  approvalSaved,
  editProposal,
  setDraft,
  duplicateMatches,
  duplicateAcknowledgement,
  setDuplicateAcknowledgement,
  duplicateKey,
  duplicatesAllowed,
  assistProposal,
  inspectProposal,
  keepRefinement,
  resolveProposal,
}: NativeTutorPanelProposalEditorProps) {
  const [showProposalDetails, setShowProposalDetails] = useState(false);
  return (
    <>
      {session?.proposal && proposalContent ? (
        <View className={"gap-[7px] py-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>Suggested card</Text>
          {approvalSaved ? (
            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
              Saved. Retry approval to finish.
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel="Proposed card question"
            multiline
            editable={!busy && !approvalSaved}
            value={proposalContent.front}
            onChangeText={(value) => {
              editProposal("front", value);
            }}
            className={
              "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          <TextInput
            accessibilityLabel="Proposed card answer"
            multiline
            editable={!busy && !approvalSaved}
            value={proposalContent.back}
            onChangeText={(value) => {
              editProposal("back", value);
            }}
            className={
              "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          <NativeButton
            label={showProposalDetails ? "Hide details" : "Details"}
            onPress={() => {
              setShowProposalDetails((current) => !current);
            }}
            className={"py-[9px] px-[4px]"}
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
          <View className={showProposalDetails ? "gap-[10px]" : "hidden"}>
            <ProposalObjectiveOptions
              area={area}
              busy={busy}
              approvalSaved={approvalSaved}
              proposalContent={proposalContent}
              proposalKey={proposalKey}
              setDraft={setDraft}
            />
            <TextInput
              accessibilityLabel="Proposed card rationale"
              multiline
              editable={!busy && !approvalSaved}
              value={proposalContent.rationale}
              onChangeText={(value) => {
                editProposal("rationale", value);
              }}
              className={
                "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
              }
            />
          </View>
          <NativeCardAssistancePanel
            key={proposalKey}
            content={proposalContent}
            proposalOnly
            disabled={busy || approvalSaved === true || !mayWrite()}
            onRefine={api ? assistProposal : undefined}
            onInspect={api ? inspectProposal : undefined}
            onApply={keepRefinement}
          />
          {!approvalSaved && (
            <NativeProposalDuplicateWarning
              matches={duplicateMatches}
              acknowledged={duplicateAcknowledgement === duplicateKey}
              disabled={busy}
              onChange={(value) => {
                setDuplicateAcknowledgement(value ? duplicateKey : null);
              }}
            />
          )}
          <View className={"flex-row gap-[8px] items-center"}>
            <NativeButton
              disabled={busy || !api || !duplicatesAllowed}
              onPress={() => void resolveProposal("approved")}
              label={approvalSaved ? "Retry approval" : "Save & approve"}
              className={"min-h-[40px] justify-center px-[13px] rounded-[10px] bg-recall-darkGreen"}
              labelClassName="text-recall-surface text-[12px] font-bold"
            />
            <NativeButton
              disabled={busy || !api || approvalSaved === true}
              onPress={() => void resolveProposal("rejected")}
              label="Reject"
              className={
                "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
              }
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
          </View>
        </View>
      ) : null}
    </>
  );
}
