import { Text, View } from "react-native";
import type { DeckFeedback, DeckVersionSummary } from "@recall/contracts";
import { NativeSelect } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
import { NativeTextField } from "../ui/NativeTextField";

export type NativeDeckSharingReportReason = "spam" | "harmful" | "copyright" | "broken";
export type NativeDeckSharingFeedbackKind = "issue" | "suggestion";

type NativeDeckSharingPanelSafetyProps = {
  readonly accountId: string | null;
  readonly canManage: boolean;
  readonly versions: readonly DeckVersionSummary[];
  readonly feedback: readonly DeckFeedback[];
  readonly blocked: boolean;
  readonly busy: boolean;
  readonly selectedVersion: string;
  readonly reportReason: NativeDeckSharingReportReason;
  readonly onReportReasonChange: (value: NativeDeckSharingReportReason) => void;
  readonly reportMessage: string;
  readonly onReportMessageChange: (value: string) => void;
  readonly onReport: () => void;
  readonly onToggleBlock: () => void;
  readonly feedbackKind: NativeDeckSharingFeedbackKind;
  readonly onFeedbackKindChange: (value: NativeDeckSharingFeedbackKind) => void;
  readonly feedbackMessage: string;
  readonly onFeedbackMessageChange: (value: string) => void;
  readonly onSubmitFeedback: () => void;
  readonly onUpdateFeedback: (item: DeckFeedback) => void;
};

type NativeDeckSharingFeedbackItemProps = {
  readonly item: DeckFeedback;
  readonly versions: readonly DeckVersionSummary[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onUpdate: (item: DeckFeedback) => void;
};

function NativeDeckSharingFeedbackItem({
  item,
  versions,
  canManage,
  busy,
  onUpdate,
}: NativeDeckSharingFeedbackItemProps) {
  return (
    <View className="gap-1 rounded-lg border border-recall-line p-3">
      <Text className="text-sm">
        {item.kind} · {item.status} · v
        {versions.find((version) => version.id === item.versionId)?.version ?? "?"}
      </Text>
      <Text className="text-sm">{item.message}</Text>
      {canManage ? (
        <NativeButton
          label={item.status === "open" ? "Mark resolved" : "Reopen"}
          tone="soft"
          disabled={busy}
          onPress={() => {
            onUpdate(item);
          }}
        />
      ) : null}
    </View>
  );
}

export function NativeDeckSharingPanelSafety({
  accountId,
  canManage,
  versions,
  feedback,
  blocked,
  busy,
  selectedVersion,
  reportReason,
  onReportReasonChange,
  reportMessage,
  onReportMessageChange,
  onReport,
  onToggleBlock,
  feedbackKind,
  onFeedbackKindChange,
  feedbackMessage,
  onFeedbackMessageChange,
  onSubmitFeedback,
  onUpdateFeedback,
}: NativeDeckSharingPanelSafetyProps) {
  return (
    <>
      {accountId && !canManage ? (
        <View className="gap-3 rounded-xl border border-recall-line p-3">
          <Text className="font-semibold">Deck safety</Text>
          <NativeSelect
            label="Report reason"
            value={reportReason}
            options={[
              { label: "Spam", value: "spam" },
              { label: "Harmful content", value: "harmful" },
              { label: "Copyright", value: "copyright" },
              { label: "Broken deck", value: "broken" },
            ]}
            onValueChange={(value) => {
              if (
                value === "spam" ||
                value === "harmful" ||
                value === "copyright" ||
                value === "broken"
              )
                onReportReasonChange(value);
            }}
          />
          <NativeTextField
            label="Report details"
            value={reportMessage}
            onChangeText={onReportMessageChange}
            maxLength={2_000}
            multiline
          />
          <NativeButton
            label="Report selected version"
            tone="soft"
            disabled={busy || !selectedVersion || !reportMessage.trim()}
            onPress={onReport}
          />
          <NativeButton
            label={blocked ? "Unblock publisher" : "Block publisher"}
            tone="soft"
            disabled={busy}
            onPress={onToggleBlock}
          />
        </View>
      ) : null}

      <View className="gap-3">
        <Text className="font-semibold">Feedback</Text>
        {accountId ? (
          <>
            <NativeSelect
              label="Feedback type"
              value={feedbackKind}
              options={[
                { label: "Suggestion", value: "suggestion" },
                { label: "Issue", value: "issue" },
              ]}
              onValueChange={(value) => {
                onFeedbackKindChange(value === "issue" ? "issue" : "suggestion");
              }}
            />
            <NativeTextField
              label="Message"
              value={feedbackMessage}
              onChangeText={onFeedbackMessageChange}
              maxLength={4000}
              multiline
              placeholder="Describe an issue or suggestion"
            />
            <NativeButton
              label="Send feedback"
              tone="soft"
              disabled={busy || !feedbackMessage.trim()}
              onPress={onSubmitFeedback}
            />
          </>
        ) : (
          <Text className="text-sm text-recall-muted">Sign in to leave feedback.</Text>
        )}
        {feedback.map((item) => (
          <NativeDeckSharingFeedbackItem
            key={item.id}
            item={item}
            versions={versions}
            canManage={canManage}
            busy={busy}
            onUpdate={onUpdateFeedback}
          />
        ))}
      </View>
    </>
  );
}
