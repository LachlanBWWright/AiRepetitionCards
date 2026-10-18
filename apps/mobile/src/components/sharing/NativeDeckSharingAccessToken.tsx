import { NativeTextField } from "../ui/NativeTextField";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
};

export function NativeDeckSharingAccessToken({ value, onChange }: Props) {
  return (
    <NativeTextField
      label="Optional unlisted deck token"
      value={value}
      onChangeText={onChange}
      secureTextEntry
      placeholder="Paste token to open an unlisted deck"
    />
  );
}
