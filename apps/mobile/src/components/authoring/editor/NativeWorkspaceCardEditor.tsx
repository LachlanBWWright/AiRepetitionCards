import type { MediaStore } from "@recall/local-store";
import { useNativeCardMedia } from "../../../hooks/use-native-card-media";
import { NativePronunciationRecorder } from "./NativePronunciationRecorder";
import { NativeImageOcclusionEditor } from "../../occlusion/NativeImageOcclusionEditor";
import { NativeReviewPresentationSettings } from "./NativeReviewPresentationSettings";
import { NativeRichTextEditor } from "../rich/NativeRichTextEditor";
import { NativeButton } from "@recall/ui-native";
import { NativeCardEditorSection } from "./NativeCardEditorSection";
import { Text, View } from "react-native";
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
        {editor.mode === "create" ? "Add card" : "Edit card"}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {(["basic", "cloze"] as const).map((kind) => (
          <NativeButton
            key={kind}
            disabled={locked}
            variant="secondary"
            selected={editor.content.kind === kind}
            label={kind === "basic" ? "Question and answer" : "Cloze · fill the gap"}
            onPress={() => {
              changeKind(kind);
            }}
          />
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
      <NativeCardEditorSection
        title="Explanation (optional)"
        initiallyOpen={Boolean(editor.content.explanation)}
      >
        <NativeRichTextEditor
          label="Explanation (optional)"
          value={editor.content.explanation ?? ""}
          media={editor.content.media}
          disabled={locked}
          maxLength={10000}
          onChange={(explanation) => {
            setEditor({ ...editor, content: { ...editor.content, explanation } });
          }}
        />
        <Text className="text-sm text-recall-muted">
          Keep the answer concise. Supporting material is available after revealing the answer.
        </Text>
      </NativeCardEditorSection>
      <NativeCardEditorSection title="Images and audio">
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
      </NativeCardEditorSection>
      <NativeCardEditorSection title="Appearance, answer and pronunciation">
        <NativeReviewPresentationSettings
          value={editor.content.presentation}
          disabled={locked}
          onChange={(presentation) => {
            setEditor({ ...editor, content: { ...editor.content, presentation } });
          }}
        />
      </NativeCardEditorSection>
      {assistancePanel}
      {detailsPanel}
      {confirmationPanel}
      {saveActions}
    </View>
  );
}
