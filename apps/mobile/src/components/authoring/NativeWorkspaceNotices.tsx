import { Text } from "react-native";

type Props = {
  readonly message: string | null;
  readonly disabledReason: string | undefined;
};
export function NativeWorkspaceNotices({ message, disabledReason }: Props) {
  return (
    <>
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
    </>
  );
}
