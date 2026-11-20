import type { ReactNode } from "react";
import { Text } from "react-native";

type Props = {
  readonly account: ReactNode;
  readonly discovery: ReactNode;
  readonly error: string | null;
};

export function NativeDeckSharingPanelBrowse({ account, discovery, error }: Props) {
  return (
    <>
      {account}
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-recall-dangerForeground">
          {error}
        </Text>
      ) : null}
      {discovery}
    </>
  );
}
