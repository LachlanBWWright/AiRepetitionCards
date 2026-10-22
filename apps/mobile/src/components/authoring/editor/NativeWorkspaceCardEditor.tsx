import type { MediaStore } from "@recall/local-store";
import { useNativeCardMedia } from "../../../hooks/use-native-card-media";
import { NativePronunciationRecorder } from "./NativePronunciationRecorder";
import { NativeImageOcclusionEditor } from "../../occlusion/NativeImageOcclusionEditor";
import { NativeReviewPresentationSettings } from "./NativeReviewPresentationSettings";
import { NativeRichTextEditor } from "../rich/NativeRichTextEditor";
import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

export type CardEditorField = (
  label: string,
  value: string,
  onChangeText: (value: string) => void,
  multiline?: boolean,
  maxLength?: number,
) => ReactNode;

export type NativeWorkspaceCardEditorProps = {
  readonly editor: Extract<Editor, { readonly kind: "card" }>;
  readonly locked: boolean;
  readonly createId: () => string;
  readonly mediaStore?: MediaStore;
  readonly field: CardEditorField;
  readonly setEditor: (editor: Editor) => void;
  readonly assistancePanel: ReactNode;
  readonly detailsPanel: ReactNode;
  readonly confirmationPanel: ReactNode;
  readonly saveActions: ReactNode;
};

export function NativeWorkspaceCardEditor({
  editor,
  locked,
  createId,
  mediaStore,
  field,
  setEditor,
  assistancePanel,
  detailsPanel,
  confirmationPanel,
  saveActions,
}: NativeWorkspaceCardEditorProps) {
  const [mediaUris] = useNativeCardMedia(mediaStore ?? null, editor.sourceCard, 0);
  const occlusionUri = editor.content.imageOcclusion
    ? mediaUris[editor.content.imageOcclusion.imageMediaId]
    : undefined;
  function changeDeletionIndex(index: string) {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        cloze: {
          text: editor.content.cloze?.text ?? "",
          deletionIndex: Number(index),
        },
      },
    });
  }
  function changeClozeText(text: string) {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        cloze: { text, deletionIndex: editor.content.cloze?.deletionIndex ?? 1 },
      },
    });
  }
  function changeKind(kind: "basic" | "cloze") {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        kind,
        ...(kind === "cloze" && !editor.content.cloze
          ? { cloze: { text: "", deletionIndex: 1 } }
          : {}),
      },
    });
  }
  return (
    <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
      <Text className={"text-recall-ink text-[16px] font-bold"}>
        {editor.mode === "create" ? "New card" : "Edit card"}
      </Text>
      <View className={"flex-row gap-[8px]"}>
        {(["basic", "cloze"] as const).map((kind) => (
          <Pressable
            key={kind}
            disabled={locked}
            accessibilityRole="radio"
            accessibilityState={{ selected: editor.content.kind === kind, disabled: locked }}
            className={"p-[10px] bg-recall-surface rounded-[8px]"}
            onPress={() => {
              changeKind(kind);
            }}
          >
            <Text>{kind === "basic" ? "Basic" : "Cloze"}</Text>
          </Pressable>
        ))}
      </View>
      {editor.content.kind === "basic" ? (
        <>
          <NativeRichTextEditor
            label="Question"
            media={editor.content.media}
            value={editor.content.front}
            disabled={locked}
            onChange={(front) => {
              setEditor({ ...editor, content: { ...editor.content, front } });
            }}
          />
          <NativeRichTextEditor
            label="Answer"
            media={editor.content.media}
            value={editor.content.back}
            disabled={locked}
            onChange={(back) => {
              setEditor({ ...editor, content: { ...editor.content, back } });
            }}
          />
        </>
      ) : (
        <>
          <NativeRichTextEditor
            label="Cloze text"
            value={editor.content.cloze?.text ?? ""}
            onChange={changeClozeText}
            media={editor.content.media}
            disabled={locked}
          />
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            {"Example: Mitochondria produce {{c1::ATP::energy molecule}}."}
          </Text>
          {field(
            "Deletion index",
            String(editor.content.cloze?.deletionIndex ?? 1),
            changeDeletionIndex,
          )}
        </>
      )}
      <NativePronunciationRecorder
        key={editor.id}
        disabled={locked || editor.content.media.length >= 20}
        onAttach={(asset) => {
          if (editor.content.media.some((item) => item.id === asset.reference.id)) return;
          setEditor({
            ...editor,
            content: { ...editor.content, media: [...editor.content.media, asset.reference] },
            stagedAssets: [...editor.stagedAssets, asset],
          });
        }}
      />
      <NativeReviewPresentationSettings
        value={editor.content.presentation}
        disabled={locked}
        onChange={(presentation) => {
          setEditor({ ...editor, content: { ...editor.content, presentation } });
        }}
      />
      <NativeImageOcclusionEditor
        value={editor.content.imageOcclusion}
        media={editor.content.media}
        field={field}
        disabled={locked}
        createId={createId}
        {...(occlusionUri ? { uri: occlusionUri } : {})}
        onChange={(imageOcclusion) => {
          setEditor({
            ...editor,
            content: { ...editor.content, imageOcclusion, removeImageOcclusion: !imageOcclusion },
          });
        }}
      />
      {assistancePanel}
      {detailsPanel}
      {confirmationPanel}
      {saveActions}
    </View>
  );
}
