import { Pressable, Text, TextInput, View } from "react-native";
import { designTokens } from "@recall/design-tokens";
import type { KnowledgeArea } from "@recall/domain";

type Visibility = "unlisted" | "public";
type Difficulty = "" | "beginner" | "intermediate" | "advanced";

type NativePublishingPanelPublishFieldsProps = {
  readonly area: KnowledgeArea | null;
  readonly visibility: Visibility;
  readonly onVisibilityChange: (value: Visibility) => void;
  readonly releaseNotes: string;
  readonly onReleaseNotesChange: (value: string) => void;
  readonly attribution: string;
  readonly onAttributionChange: (value: string) => void;
  readonly difficulty: Difficulty;
  readonly onDifficultyChange: (value: Difficulty) => void;
  readonly license: string;
  readonly onLicenseChange: (value: string) => void;
  readonly needsReuseConfirmation: boolean;
  readonly reuseConfirmed: boolean;
  readonly onReuseConfirmedChange: (value: boolean) => void;
};

const palette = designTokens.color;

export function NativePublishingPanelPublishFields({
  area,
  visibility,
  onVisibilityChange,
  releaseNotes,
  onReleaseNotesChange,
  attribution,
  onAttributionChange,
  difficulty,
  onDifficultyChange,
  license,
  onLicenseChange,
  needsReuseConfirmation,
  reuseConfirmed,
  onReuseConfirmedChange,
}: NativePublishingPanelPublishFieldsProps) {
  return (
    <>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Choose public discovery or an unlisted link. Your review history and schedule stay private.
      </Text>
      <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>
        Publish {area ? `“${area.title}”` : "an area"}
      </Text>
      <View className={"flex-row gap-[8px]"}>
        {(["unlisted", "public"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: visibility === item }}
            onPress={() => {
              onVisibilityChange(item);
            }}
            className={`flex-1 items-center py-[9px] rounded-[9px] bg-recall-paper ${visibility === item ? "bg-recall-green" : ""}`}
          >
            <Text className={"text-recall-darkGreen text-[12px] font-bold capitalize"}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        {visibility === "public"
          ? "Anyone can find and view this area."
          : "Anyone with the share token can view this area."}
      </Text>
      <TextInput
        accessibilityLabel="Release notes"
        onChangeText={onReleaseNotesChange}
        placeholder="What changed in this release? (optional)"
        placeholderTextColor={palette.muted}
        maxLength={4_000}
        multiline
        className={"min-h-[72px] px-[12px] py-[10px] rounded-[9px] bg-recall-paper text-recall-ink"}
        value={releaseNotes}
      />
      <TextInput
        accessibilityLabel="Attribution"
        onChangeText={onAttributionChange}
        placeholder="Attribution (optional)"
        placeholderTextColor={palette.muted}
        maxLength={200}
        className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
        value={attribution}
      />
      <Text className="text-xs font-semibold text-recall-muted">Difficulty (optional)</Text>
      <View className="flex-row gap-2">
        {(["", "beginner", "intermediate", "advanced"] as const).map((value) => (
          <Pressable
            key={value || "unspecified"}
            accessibilityRole="button"
            accessibilityState={{ selected: difficulty === value }}
            onPress={() => {
              onDifficultyChange(value);
            }}
            className={`flex-1 items-center rounded-[9px] py-[9px] ${difficulty === value ? "bg-recall-green" : "bg-recall-paper"}`}
          >
            <Text className="text-xs font-bold capitalize text-recall-darkGreen">
              {value || "unspecified"}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="License"
        onChangeText={(value) => {
          onLicenseChange(value);
          onReuseConfirmedChange(false);
        }}
        placeholder="Choose a license explicitly"
        placeholderTextColor={palette.muted}
        maxLength={120}
        className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
        value={license}
      />
      {needsReuseConfirmation && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: reuseConfirmed }}
          onPress={() => {
            onReuseConfirmedChange(!reuseConfirmed);
          }}
          className={"flex-1 items-center py-[9px] rounded-[9px] bg-recall-paper"}
        >
          <Text>
            {reuseConfirmed ? "☑" : "☐"} I own this content or have permission to share it under the
            selected license.
          </Text>
        </Pressable>
      )}
    </>
  );
}
