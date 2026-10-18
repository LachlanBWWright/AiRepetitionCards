import { useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { NativeButton, NativeTextField } from "@recall/ui-native";
export type NativeChatMessage = {
  readonly id: string;
  readonly role: "learner" | "assistant";
  readonly content: string;
};
export function NativeChatRoom(props: {
  readonly label: string;
  readonly greeting: string;
  readonly placeholder: string;
  readonly messages: readonly NativeChatMessage[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly maxLength: number;
  readonly afterMessages?: ReactNode;
  readonly pendingMessage?: string | undefined;
  readonly footer?: string;
}) {
  const scroll = useRef<ScrollView>(null);
  const empty = props.messages.length === 0 && !props.pendingMessage;
  return (
    <KeyboardAvoidingView
      className="min-h-0 flex-1"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      accessibilityLabel={`${props.label} conversation`}
    >
      <ScrollView
        ref={scroll}
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onContentSizeChange={() => {
          scroll.current?.scrollToEnd({ animated: false });
        }}
      >
        <View className={`flex-1 gap-5 p-5 ${empty ? "justify-center" : ""}`}>
          {empty && (
            <Text className="text-center text-2xl font-medium text-recall-ink">
              {props.greeting}
            </Text>
          )}
          {props.messages.map((message) => (
            <NativeChatBubble key={message.id} message={message} />
          ))}
          {props.pendingMessage && (
            <NativeChatBubble
              message={{ id: "pending", role: "learner", content: props.pendingMessage }}
            />
          )}
          {props.busy && (
            <Text accessibilityLiveRegion="polite" className="text-sm text-recall-muted">
              Thinking…
            </Text>
          )}
          {props.afterMessages}
        </View>
      </ScrollView>
      <View className="shrink-0 gap-2 px-4 pb-3 pt-2">
        <View className="flex-row items-end gap-2 rounded-2xl border border-recall-line bg-recall-surface p-2">
          <NativeTextField
            label={`${props.label} message`}
            hideLabel
            placeholder={props.placeholder}
            multiline
            value={props.value}
            onChangeText={props.onChange}
            maxLength={props.maxLength}
            editable={!props.disabled && !props.busy}
            className="flex-1"
            inputClassName="max-h-40 min-h-11 border-0 bg-transparent"
          />
          <NativeButton
            label="↑"
            accessibilityLabel="Send message"
            className="size-11 min-h-11 rounded-full px-0"
            disabled={props.disabled || props.busy || !props.value.trim()}
            onPress={props.onSend}
          />
        </View>
        {props.footer && (
          <Text className="text-center text-xs text-recall-muted">{props.footer}</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
function NativeChatBubble({ message }: { readonly message: NativeChatMessage }) {
  return (
    <View
      className={
        message.role === "learner"
          ? "ml-auto max-w-[85%] rounded-2xl bg-recall-surface px-4 py-3"
          : "max-w-full"
      }
    >
      <Text
        accessibilityLabel={`${message.role === "learner" ? "You" : "Tutor"}: ${message.content}`}
        className="text-base leading-7 text-recall-ink"
      >
        {message.content}
      </Text>
    </View>
  );
}
