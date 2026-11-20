import { Text, View } from "react-native";
import type { ActivityPresentation } from "@recall/application";
import type { ActivityResponse } from "@recall/domain";
import { Either, Schema } from "effect";
import { NativeOrderingActivity } from "./NativeOrderingActivity";
import { NativeMatchingActivity } from "./NativeMatchingActivity";
import { NativeCodeTracingActivity } from "./NativeCodeTracingActivity";

export type NativeInteractiveActivityWorkspaceProps = {
  readonly presentation: ActivityPresentation;
  readonly response: ActivityResponse;
  readonly disabled: boolean;
  readonly onChange: (response: ActivityResponse) => void;
};

export function nativeInteractiveResponseReady(
  presentation: ActivityPresentation,
  response: ActivityResponse,
): boolean {
  const game = presentation.interactive;
  if (!game) return false;
  if (game.kind === "ordering") return game.items.length === response.selectedOptionIds.length;
  if (game.kind === "code-tracing") return response.answers.length === 1;
  const parsed = Schema.decodeUnknownEither(
    Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.String })),
  )(response.answers[0] ?? "{}");
  return (
    Either.isRight(parsed) &&
    game.left.every(
      (item) => Object.hasOwn(parsed.right, item.id) && Boolean(parsed.right[item.id]),
    )
  );
}

export function NativeInteractiveActivityWorkspace({
  presentation,
  response,
  disabled,
  onChange,
}: NativeInteractiveActivityWorkspaceProps) {
  const game = presentation.interactive;
  if (!game) return null;
  const change = (next: ActivityResponse) => {
    onChange({
      ...next,
      ...("seed" in game ? { interaction: { ...next.interaction, seed: game.seed } } : {}),
    });
  };
  return (
    <View className="gap-3">
      {presentation.prompts.map((prompt, index) => (
        <Text key={index}>{prompt}</Text>
      ))}
      {game.kind === "ordering" && (
        <NativeOrderingActivity
          items={game.items}
          response={response}
          disabled={disabled}
          onChange={change}
        />
      )}
      {game.kind === "matching" && (
        <NativeMatchingActivity
          left={game.left}
          right={game.right}
          response={response}
          disabled={disabled}
          onChange={change}
        />
      )}
      {game.kind === "code-tracing" && (
        <NativeCodeTracingActivity
          code={game.code}
          language={game.language}
          response={response}
          disabled={disabled}
          onChange={change}
        />
      )}
    </View>
  );
}
