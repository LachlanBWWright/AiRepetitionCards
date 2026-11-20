import { NativeSelect, NativeTextField } from "@recall/ui-native";

import { Pressable, Text } from "react-native";
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
      <NativeSelect
        label="Visibility"
        value={visibility}
        options={[
          { label: "Unlisted · link access", value: "unlisted" },
          { label: "Public access", value: "public" },
        ]}
        onValueChange={(value) => {
          if (value === "unlisted" || value === "public") onVisibilityChange(value);
        }}
      />
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        {visibility === "public"
          ? "Anyone can find and view this area."
          : "Anyone with the share token can view this area."}
      </Text>
      <NativeTextField
        label="Release notes (optional)"
        onChangeText={onReleaseNotesChange}
        placeholder="What changed in this release? (optional)"
        maxLength={4_000}
        multiline
        inputClassName="min-h-[72px]"
        value={releaseNotes}
      />
      <NativeTextField
        label="Attribution"
        onChangeText={onAttributionChange}
        placeholder="Attribution (optional)"
        maxLength={200}
        value={attribution}
      />
      <NativeSelect
        label="Difficulty (optional)"
        value={difficulty || "unspecified"}
        options={[
          { label: "Unspecified", value: "unspecified" },
          { label: "Beginner", value: "beginner" },
          { label: "Intermediate", value: "intermediate" },
          { label: "Advanced", value: "advanced" },
        ]}
        onValueChange={(value) => {
          if (value === "unspecified") onDifficultyChange("");
          else if (value === "beginner" || value === "intermediate" || value === "advanced")
            onDifficultyChange(value);
        }}
      />
      <NativeTextField
        label="License"
        onChangeText={(value) => {
          onLicenseChange(value);
          onReuseConfirmedChange(false);
        }}
        placeholder="Choose a license explicitly"
        maxLength={120}
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
