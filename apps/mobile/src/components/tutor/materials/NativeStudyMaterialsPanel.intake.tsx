import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { createNativeStudyIntakeActions } from "./native-study-material-intake-workflow";
import { NativeButton } from "../../ui/NativeButton";
import { extractNativeOcr } from "../../../storage/materials/native-study-material-ocr";
import { pickNativeStudyFile } from "../../../storage/materials/native-study-material-files";
import {
  extractNativeStudyFile,
  extractNativeStudyPaste,
} from "../../../storage/materials/native-study-material-extraction";
import type { StudyMaterial } from "@recall/application";

export type NativeStudyMaterialsExtraction = {
  readonly format: StudyMaterial["format"];
  readonly sections: readonly {
    readonly title: string;
    readonly pageNumber: number | null;
    readonly text: string;
  }[];
  readonly warnings: readonly string[];
};

type Props = {
  readonly disabled: boolean;
  readonly runAction: (operation: (isCurrent: () => boolean) => Promise<void>) => Promise<void>;
  readonly onPreview: (name: string, extraction: NativeStudyMaterialsExtraction) => void;
  readonly onNotice: (notice: string) => void;
};

export function NativeStudyMaterialsPanelIntake({
  disabled,
  runAction,
  onPreview,
  onNotice,
}: Props) {
  const [showOcr, setShowOcr] = useState(false);
  const [paste, setPaste] = useState("");
  const [name, setName] = useState("Study notes");
  const [ocrFirst, setOcrFirst] = useState("1");
  const [ocrLast, setOcrLast] = useState("1");
  const actions = createNativeStudyIntakeActions(
    { name, paste, ocrFirst, ocrLast },
    {
      runAction,
      onPreview,
      onNotice,
      pickFile: pickNativeStudyFile,
      extractFile: extractNativeStudyFile,
      extractPaste: extractNativeStudyPaste,
      ocr: extractNativeOcr,
    },
  );
  const button = (label: string, action: () => void, blocked = disabled) => (
    <NativeButton
      key={label}
      label={label}
      onPress={action}
      disabled={blocked}
      className="py-[10px] px-[4px]"
      labelClassName="text-recall-surface text-[12px] font-bold"
    />
  );

  return (
    <View className="gap-[10px]">
      <Text className="text-recall-ink text-[14px] font-bold">Add material</Text>
      <Text className="text-recall-muted text-[11px] leading-[16px]">Name</Text>
      <TextInput
        accessibilityLabel="Material name"
        value={name}
        onChangeText={setName}
        maxLength={200}
        className="p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"
      />
      <TextInput
        accessibilityLabel="Paste study material"
        value={paste}
        onChangeText={setPaste}
        multiline
        maxLength={1000000}
        placeholder="Paste your study notes here"
        className="p-[10px] rounded-[8px] bg-recall-paper text-recall-ink min-h-[120px] max-h-[260px]"
      />
      <View className="flex-row flex-wrap gap-[7px]">
        {button("Check pasted text", actions.checkPaste, disabled || !paste.trim())}
        {button("Upload document", actions.uploadDocument)}
      </View>
      {button(showOcr ? "Close scanned import" : "Scanned PDF or image", () => {
        setShowOcr((current) => !current);
      })}
      <View className={showOcr ? "gap-[10px]" : "hidden"}>
        <Text className="text-recall-muted text-[11px] leading-[16px]">
          PDF pages (up to 20). English text recognition.
        </Text>
        <View className="flex-row flex-wrap gap-[7px]">
          <Text className="text-recall-muted text-[11px] leading-[16px]">From page</Text>
          <TextInput
            accessibilityLabel="First OCR page"
            value={ocrFirst}
            onChangeText={setOcrFirst}
            keyboardType="number-pad"
            maxLength={6}
            className="p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"
          />
          <Text className="text-recall-muted text-[11px] leading-[16px]">To page</Text>
          <TextInput
            accessibilityLabel="Last OCR page"
            value={ocrLast}
            onChangeText={setOcrLast}
            keyboardType="number-pad"
            maxLength={6}
            className="p-[10px] rounded-[8px] bg-recall-paper text-recall-ink"
          />
          {button("Upload scan", actions.uploadScan, disabled)}
        </View>
      </View>
    </View>
  );
}
