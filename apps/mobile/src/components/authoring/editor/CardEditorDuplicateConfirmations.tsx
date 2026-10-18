import { Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";
import type { CardRefinementResult } from "@recall/ai-core";
import type { CardDuplicateMatch } from "@recall/application";

export type CardEditorDuplicateConfirmationsProps = {
  readonly locked: boolean;
  readonly refinementDuplicate: {
    readonly result: CardRefinementResult;
    readonly key: string;
    readonly descriptions: readonly string[];
  } | null;
  readonly applyRefinement: (
    result: CardRefinementResult,
    acceptedKey?: string,
  ) => Promise<boolean>;
  readonly setRefinementDuplicate: (value: null) => void;
  readonly draftDuplicates: readonly CardDuplicateMatch[];
  readonly duplicatesAccepted: boolean;
  readonly duplicateDraftKey: string;
  readonly setKeptDuplicateDraft: (key: string) => void;
};

export function CardEditorDuplicateConfirmations({
  locked,
  refinementDuplicate,
  applyRefinement,
  setRefinementDuplicate,
  draftDuplicates,
  duplicatesAccepted,
  duplicateDraftKey,
  setKeptDuplicateDraft,
}: CardEditorDuplicateConfirmationsProps) {
  return (
    <>
      {refinementDuplicate && (
        <View className="gap-[8px] pb-[12px]">
          <Text className="text-recall-ink text-[16px] font-bold">Refinement duplicates</Text>
          {refinementDuplicate.descriptions.map((description, index) => (
            <Text
              key={`${String(index)}:${description}`}
              className="text-recall-muted text-[12px] leading-[18px]"
            >
              {description}
            </Text>
          ))}
          <NativeButton
            label="Keep both and apply refinement"
            tone="soft"
            disabled={locked}
            onPress={() => {
              void applyRefinement(refinementDuplicate.result, refinementDuplicate.key);
            }}
          />
          <NativeButton
            label="Cancel refinement"
            tone="soft"
            disabled={locked}
            onPress={() => {
              setRefinementDuplicate(null);
            }}
          />
        </View>
      )}
      {draftDuplicates.length > 0 && (
        <View className="gap-[8px] pb-[12px]">
          <Text className="text-recall-ink text-[16px] font-bold">Possible duplicates</Text>
          {draftDuplicates.map((match) => (
            <View key={match.candidate.id} className="border-t border-recall-line py-[8px]">
              <Text className="text-recall-ink text-[13px] font-semibold">
                {match.candidate.front}
              </Text>
              <Text>{match.candidate.back}</Text>
              <Text className="text-recall-muted text-[12px] leading-[18px]">
                {match.candidate.areaTitle} · {match.reason}
              </Text>
            </View>
          ))}
          <NativeButton
            label={duplicatesAccepted ? "Keep both selected" : "Keep both"}
            tone="soft"
            disabled={locked}
            onPress={() => {
              setKeptDuplicateDraft(duplicateDraftKey);
            }}
          />
        </View>
      )}
    </>
  );
}
