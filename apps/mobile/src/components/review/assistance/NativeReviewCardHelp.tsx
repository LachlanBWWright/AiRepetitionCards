import { NativeCardRichText } from "../../authoring/rich/NativeCardRichText";
import { NativeCollapsible, NativeButtonPrimitive, NativeButtonText } from "@recall/ui-native";
import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { NativeButton } from "@recall/ui-native";
import { adaptStudyCommandSave, useReviewRepair } from "@recall/react";
import {
  reviewRepairActions,
  reviewRepairCopy as copy,
  reviewRepairApprovalNote,
  type ReviewRepairAction,
  type requestReviewRepair,
} from "@recall/application";
import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import * as Crypto from "expo-crypto";
import type { NativeStudyCommand } from "../../../hooks/use-native-study-command";

export function NativeReviewCardHelp({
  workspace,
  area,
  card,
  api,
  save,
  disabled,
  onInteractionChange,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly card: Assessment;
  readonly api: Parameters<typeof requestReviewRepair>[0] | null;
  readonly save: NativeStudyCommand | undefined;
  readonly disabled: boolean;
  readonly onInteractionChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const repair = useReviewRepair({
    workspace,
    area,
    card,
    api,
    save: save ? adaptStudyCommandSave(save) : undefined,
    disabled,
    createId: Crypto.randomUUID,
    clock: Date.now,
  });
  useEffect(
    () => () => {
      onInteractionChange(false);
    },
    [onInteractionChange],
  );
  return (
    <View className="gap-3">
      <NativeCollapsible
        open={open}
        title={copy.title}
        onToggle={() => {
          setOpen(!open);
          onInteractionChange(!open);
        }}
        disabled={disabled || repair.busy}
      >
        <View className="gap-3 rounded-lg border border-recall-line p-4">
          <Text className="text-sm text-recall-muted">{copy.description}</Text>
          {!api && (
            <Text className="text-sm text-recall-muted">
              Connect AI in Account to use card help.
            </Text>
          )}
          <NativeCardHelpContext card={card} />
          <Text className="text-sm font-semibold text-recall-ink">{copy.options}</Text>
          <NativeHelpOptions
            disabled={disabled || repair.busy || !api}
            onRequest={repair.request}
          />
          {repair.busy && (
            <Text accessibilityLiveRegion="polite" className="text-sm text-recall-muted">
              {copy.working}
            </Text>
          )}
          {repair.message && (
            <Text
              className="text-sm text-recall-ink"
              accessibilityRole={repair.messageIsError ? "alert" : "text"}
              accessibilityLiveRegion="polite"
            >
              {repair.message}
            </Text>
          )}
          {repair.visibleProposal?.kind === "explanation" && (
            <View className="gap-3 border-t border-recall-line pt-4">
              <Text accessibilityRole="header" className="font-semibold text-recall-ink">
                {copy.response}
              </Text>
              <NativeCardRichText variant="body" text={repair.visibleProposal.text} />
            </View>
          )}
          <NativeReviewRepairProposal repair={repair} />
          <Text className="border-t border-recall-line pt-3 text-xs leading-5 text-recall-muted">
            {copy.paused}
          </Text>
        </View>
      </NativeCollapsible>
    </View>
  );
}

function NativeCardHelpContext({ card }: { readonly card: Assessment }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2 border-b border-recall-line pb-3">
      <Text className="text-xs text-recall-muted">{copy.context}</Text>
      <NativeCardRichText variant="body" text={card.front} />
      <NativeCollapsible
        title={copy.answer}
        open={open}
        onToggle={() => {
          setOpen((value) => !value);
        }}
      >
        <NativeCardRichText variant="body" text={card.back} />
      </NativeCollapsible>
    </View>
  );
}

function NativeHelpOptions({
  disabled,
  onRequest,
}: {
  readonly disabled: boolean;
  readonly onRequest: (action: ReviewRepairAction) => void;
}) {
  const requestAction = (action: ReviewRepairAction) => () => {
    onRequest(action);
  };
  return (
    <View className="gap-3">
      {reviewRepairActions.map((action) => (
        <NativeButtonPrimitive
          key={action.value}
          variant="secondary"
          layout="column"
          accessibilityLabel={action.label}
          disabled={disabled}
          onPress={requestAction(action.value)}
        >
          <NativeButtonText variant="secondary">{action.label}</NativeButtonText>
          <NativeButtonText variant="secondary" detail>
            {action.description}
          </NativeButtonText>
        </NativeButtonPrimitive>
      ))}
    </View>
  );
}

function NativeReviewRepairProposal({
  repair,
}: {
  readonly repair: ReturnType<typeof useReviewRepair>;
}) {
  if (repair.visibleProposal?.kind !== "cards") return null;
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-bold text-recall-ink">
        {copy.original}
      </Text>
      <NativeCardRichText variant="body" text={repair.original.front} />
      <NativeCardRichText variant="body" text={repair.original.back} />
      <Text accessibilityRole="header" className="font-bold text-recall-ink">
        {copy.proposed}
      </Text>
      {repair.visibleProposal.refinement.cards.map((item, index) => (
        <View key={index} className="gap-2 border border-recall-line p-3">
          <NativeCardRichText variant="body" text={item.front} />
          <NativeCardRichText variant="body" text={item.back} />
          <Text>{item.rationale}</Text>
        </View>
      ))}
      <Text>{reviewRepairApprovalNote(repair.visibleProposal.action)}</Text>
      {repair.duplicates && (
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-sm text-recall-ink">{copy.duplicates}</Text>
          <Switch
            accessibilityLabel={copy.duplicates}
            value={repair.allowDuplicates}
            disabled={repair.busy}
            onValueChange={repair.setAllowDuplicates}
          />
        </View>
      )}
      <NativeButton label={copy.approve} disabled={!repair.canApprove} onPress={repair.approve} />
      <NativeButton
        variant="secondary"
        label={copy.discard}
        disabled={repair.busy}
        onPress={repair.discard}
      />
    </View>
  );
}
