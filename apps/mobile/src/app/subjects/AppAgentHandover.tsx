import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Effect } from "effect";
import * as Crypto from "expo-crypto";
import type { AgentDialogue, WorkspaceAuthoringCommand } from "@recall/application";
import { NativeCollapsible } from "@recall/ui-native";
import { NativeAgentHandoverPanel } from "../../components/tutor/handover/NativeAgentHandoverPanel";
import { nativeAgentTransferPorts } from "../../storage/interchange/native-agent-transfer";
import type { AppModel } from "../useAppController";

export function AppAgentHandover({
  model,
  areaId,
  conversation,
}: {
  readonly model: AppModel;
  readonly areaId: string;
  readonly conversation?: AgentDialogue;
}) {
  const [open, setOpen] = useState(false);
  if (!model.workspace) return null;
  const saveChanges = (command: WorkspaceAuthoringCommand) =>
    Effect.tryPromise({
      try: () => model.applyAuthoringCommand(command),
      catch: () => ({ message: "Could not save these changes. Your proposal is still available." }),
    }).pipe(
      Effect.flatMap((result) =>
        result.ok ? Effect.void : Effect.fail({ message: result.message }),
      ),
    );
  return (
    <View className="px-4">
      <NativeCollapsible
        title="Use external AI"
        open={open}
        onToggle={() => {
          setOpen((value) => !value);
        }}
      >
        <ScrollView
          style={{ maxHeight: 420 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          <NativeAgentHandoverPanel
            key={`${model.accountUserId ?? "local"}:${String(model.operationGeneration)}:${areaId}`}
            workspace={model.workspace}
            areaId={areaId}
            conversation={conversation}
            disabled={model.reviewPending || !model.cacheWritable}
            createId={Crypto.randomUUID}
            ports={nativeAgentTransferPorts}
            saveChanges={saveChanges}
          />
        </ScrollView>
      </NativeCollapsible>
    </View>
  );
}
