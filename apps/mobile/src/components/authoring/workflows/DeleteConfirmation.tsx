import { Text, View } from "react-native";
import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import { NativeButton } from "../../ui/NativeButton";

type Field = (label: string, value: string, onChangeText: (value: string) => void) => ReactNode;
type Submit = (command: unknown, baseline?: string) => void;

export type DeleteConfirmationProps = {
  readonly editor: Editor | null;
  readonly confirmation: string;
  readonly setConfirmation: Dispatch<SetStateAction<string>>;
  readonly field: Field;
  readonly locked: boolean;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly submit: Submit;
  readonly onCancel: () => void;
};

export function DeleteConfirmation({
  editor,
  confirmation,
  setConfirmation,
  field,
  locked,
  disabled,
  pending,
  submit,
  onCancel,
}: DeleteConfirmationProps) {
  return (
    <>
      {editor?.kind === "delete" && (
        <View className="gap-[12px] py-[16px] border-t border-recall-line">
          <Text className="text-recall-ink text-[16px] font-bold">{editor.title}</Text>
          <Text className="text-recall-muted text-[12px] leading-[18px]">
            This removes the card or area. Review history is kept. Type DELETE to confirm.
          </Text>
          {field("Deletion confirmation", confirmation, setConfirmation)}
          <NativeButton
            label="Confirm deletion"
            tone="soft"
            disabled={locked || confirmation !== "DELETE"}
            onPress={() => {
              submit(editor.command, editor.baseline);
            }}
          />
        </View>
      )}
      {editor && (
        <NativeButton
          label="Cancel editing"
          tone="soft"
          disabled={disabled || pending}
          onPress={onCancel}
        />
      )}
    </>
  );
}
