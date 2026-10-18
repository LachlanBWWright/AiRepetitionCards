import { Pressable, Text, View } from "react-native";
import { NativeButton } from "../../ui/NativeButton";
import type { LearningArea } from "@recall/domain";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { CardEditorField } from "./NativeWorkspaceCardEditor";

type CardEditor = Extract<Editor, { readonly kind: "card" }>;

export type CardEditorDetailsProps = {
  readonly editor: CardEditor;
  readonly locked: boolean;
  readonly field: CardEditorField;
  readonly setEditor: (editor: Editor) => void;
  readonly editorArea: LearningArea | undefined;
  readonly showCardDetails: boolean;
  readonly setShowCardDetails: (show: boolean | ((value: boolean) => boolean)) => void;
  readonly onPickAttachment: (() => void) | undefined;
  readonly picking: boolean;
  readonly pickAttachment: () => Promise<void>;
};

export function CardEditorDetails({
  editor,
  locked,
  field,
  setEditor,
  editorArea,
  showCardDetails,
  setShowCardDetails,
  onPickAttachment,
  picking,
  pickAttachment,
}: CardEditorDetailsProps) {
  function removeAttachment(attachmentId: string) {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        media: editor.content.media.filter((item) => item.id !== attachmentId),
      },
      stagedAssets: editor.stagedAssets.filter((asset) => asset.reference.id !== attachmentId),
    });
  }

  function toggleObjective(objectiveId: CardEditor["content"]["objectiveIds"][number]) {
    setEditor({
      ...editor,
      content: {
        ...editor.content,
        objectiveIds: editor.content.objectiveIds.includes(objectiveId)
          ? editor.content.objectiveIds.filter((id) => id !== objectiveId)
          : [...editor.content.objectiveIds, objectiveId],
      },
    });
  }
  return (
    <>
      <NativeButton
        label={showCardDetails ? "Hide card details" : "Card details"}
        tone="soft"
        onPress={() => {
          setShowCardDetails((value) => !value);
        }}
      />
      {showCardDetails && (
        <View className="gap-[12px]">
          {field(
            "Card tags (comma separated)",
            editor.tagsText,
            (tagsText) => {
              setEditor({ ...editor, tagsText });
            },
            true,
          )}
          <Text className="text-recall-muted text-[12px] leading-[18px]">
            Separate tags with commas. Quote tags containing commas; double embedded quotes inside a
            quoted tag.
          </Text>
          <Text className="text-recall-ink text-[13px] font-semibold">Learning objectives</Text>
          {editorArea?.objectives?.map((objective) => (
            <Pressable
              key={objective.id}
              disabled={locked}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: editor.content.objectiveIds.includes(objective.id),
                disabled: locked,
              }}
              onPress={() => {
                toggleObjective(objective.id);
              }}
              className="p-[10px] bg-recall-surface rounded-[8px]"
            >
              <Text>
                {editor.content.objectiveIds.includes(objective.id) ? "☑" : "☐"} {objective.title}
              </Text>
            </Pressable>
          ))}
          {editor.content.media.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              locked={locked}
              onRemove={removeAttachment}
            />
          ))}
          {onPickAttachment && (
            <NativeButton
              label={picking ? "Choosing attachment…" : "Add image or audio"}
              tone="soft"
              disabled={locked || editor.content.media.length >= 20}
              onPress={() => {
                void pickAttachment();
              }}
            />
          )}
        </View>
      )}
    </>
  );
}

function AttachmentRow({
  attachment,
  locked,
  onRemove,
}: {
  readonly attachment: CardEditor["content"]["media"][number];
  readonly locked: boolean;
  readonly onRemove: (id: string) => void;
}) {
  return (
    <View>
      <Text className="text-recall-muted text-[12px] leading-[18px]">
        {attachment.mimeType.startsWith("image/") ? "Image" : "Audio"} attachment
      </Text>
      <NativeButton
        label="Remove attachment"
        tone="soft"
        disabled={locked}
        onPress={() => {
          onRemove(attachment.id);
        }}
      />
    </View>
  );
}
