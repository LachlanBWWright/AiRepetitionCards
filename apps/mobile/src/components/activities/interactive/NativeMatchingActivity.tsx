import { Text, View } from "react-native";
import { NativeSelect } from "@recall/ui-native";
import { canonicalMatchingAnswer } from "@recall/application";
import type { ActivityResponse } from "@recall/domain";
import { Either, Schema } from "effect";

type Item = { readonly id: string; readonly text: string };
const mappingSchema = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.String }));

export function NativeMatchingActivity({
  left,
  right,
  response,
  disabled,
  onChange,
}: {
  readonly left: readonly Item[];
  readonly right: readonly Item[];
  readonly response: ActivityResponse;
  readonly disabled: boolean;
  readonly onChange: (response: ActivityResponse) => void;
}) {
  const parsed = Schema.decodeUnknownEither(mappingSchema)(response.answers[0] ?? "{}");
  const matches: Readonly<Record<string, string>> = Either.isRight(parsed) ? parsed.right : {};
  function matchFor(id: string): string {
    return Object.hasOwn(matches, id) ? (matches[id] ?? "") : "";
  }
  function optionsFor(id: string) {
    return [
      { value: "", label: "Choose a match" },
      ...right
        .filter(
          (choice) => choice.id === matchFor(id) || !Object.values(matches).includes(choice.id),
        )
        .map((choice) => ({ value: choice.id, label: choice.text })),
    ];
  }
  return (
    <View className="gap-3">
      <Text>Choose one match for each item. Each answer can be used once.</Text>
      {left.map((item, index) => (
        <NativeSelect
          key={item.id}
          label={`${String(index + 1)}. Match: ${item.text}`}
          value={matchFor(item.id)}
          disabled={disabled}
          options={optionsFor(item.id)}
          onValueChange={(value) => {
            const entries = Object.entries(matches).filter(([id]) => id !== item.id);
            const next = Object.fromEntries(value ? [...entries, [item.id, value]] : entries);
            onChange({
              ...response,
              answers: [canonicalMatchingAnswer(next)],
              selectedOptionIds: [],
            });
          }}
        />
      ))}
    </View>
  );
}
