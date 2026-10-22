import { NativeNoteOwnershipImpact } from "./NativeNoteOwnershipImpact";
import { NativeNoteLifecycleImpact } from "./NativeNoteLifecycleEditor";
import { NativeNoteAttachments } from "./NativeNoteAttachments";
import type { Effect } from "effect";
import type { StoredMediaAsset } from "@recall/local-store";
import { useState } from "react";
import { Text, View } from "react-native";
import { Either } from "effect";
import { useNoteAuthoring, type NoteAuthoringProps } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";
import { NativeWorkspaceField } from "../editor/NativeWorkspaceField";
import { NativeRichTextEditor } from "../rich/NativeRichTextEditor";
import { NativeCardRichText } from "../rich/NativeCardRichText";
import { NativeNoteTypeEditor } from "./NativeNoteTypeEditor";

type Props = NoteAuthoringProps & {
  readonly disabled?: boolean | undefined;
  readonly pickAttachment?:
    (() => Effect.Effect<StoredMediaAsset | null, { readonly message: string }>) | undefined;
};
export function NativeNoteLibraryEditor(props: Props) {
  const model = useNoteAuthoring(props);
  const [customizing, setCustomizing] = useState(false);
  const [preview, setPreview] = useState(false);
  const locked = props.disabled || model.busy;
  return (
    <View className="gap-5 py-2">
      <Text className="font-bold text-recall-ink text-2xl">Create from a note</Text>
      {!props.initialNoteId && (
        <View className="flex-row gap-2 flex-wrap">
          {model.types.map((type) => (
            <NativeButton
              key={type.id}
              label={type.name}
              selected={model.type.id === type.id}
              tone={model.type.id === type.id ? "dark" : "soft"}
              className="flex-1 min-w-24"
              disabled={locked}
              onPress={() => {
                model.selectType(type.id);
              }}
            />
          ))}
        </View>
      )}
      {(model.area.noteLibrary?.notes ?? []).map((note) => (
        <NativeButton
          key={note.id}
          label={`Open: ${Object.values(note.fields).find(Boolean)?.slice(0, 55) ?? note.id}`}
          tone="soft"
          disabled={locked}
          onPress={() => {
            model.selectNote(note.id);
          }}
        />
      ))}
      {model.availableImages.slice(0, 20).map((image, index) => (
        <NativeButton
          key={image.id}
          label={`Insert existing image ${String(index + 1)} in first field`}
          tone="soft"
          disabled={locked}
          onPress={() => {
            model.insertImage(image.id);
          }}
        />
      ))}
      <NativeNoteAttachments
        model={model}
        area={model.area}
        disabled={locked}
        pickAttachment={props.pickAttachment}
      />
      {model.type.fields.map((field) => (
        <View
          key={field.name}
          className="gap-2 rounded-xl border border-recall-line bg-recall-surface p-3"
        >
          <NativeRichTextEditor
            label={`${field.name}${field.sticky ? " (kept for next note)" : ""}`}
            value={model.note.fields[field.name] ?? ""}
            onChange={(value) => {
              model.updateField(field.name, value);
            }}
            showPreview={false}
            media={model.note.media ?? []}
            disabled={locked}
          />
        </View>
      ))}
      <NativeWorkspaceField
        editor={null}
        locked={locked}
        label="Tags"
        value={model.tagsText}
        onChangeText={model.setTagsText}
      />
      <NativeButton
        label={customizing ? "Hide type editor ▴" : "Customize fields and templates ▾"}
        tone="soft"
        disabled={locked}
        onPress={() => {
          setCustomizing(!customizing);
        }}
      />
      {customizing && <NativeNoteTypeEditor model={model} disabled={locked} />}
      <NativeButton
        label={preview ? "Hide generated cards ▴" : "Preview generated cards ▾"}
        tone="soft"
        onPress={() => {
          setPreview(!preview);
        }}
      />
      {preview &&
        (Either.isLeft(model.preview) ? (
          <Text>{model.preview.left.message}</Text>
        ) : (
          model.preview.right.map((card, index) => (
            <View
              key={`${card.templateId}:${String(card.deletionIndex ?? 0)}`}
              className="border border-recall-line p-2"
            >
              <Text className="font-bold">Card {index + 1}</Text>
              <NativeCardRichText text={card.front} appearance={card.presentation?.appearance} />
              <NativeCardRichText text={card.back} appearance={card.presentation?.appearance} />
            </View>
          ))
        ))}
      <NativeNoteOwnershipImpact model={model} disabled={locked} />
      <NativeNoteLifecycleImpact model={model} disabled={locked} />
      <NativeButton
        label={model.busy ? "Saving…" : "Save note"}
        disabled={
          locked ||
          Either.isLeft(model.preview) ||
          (model.affectsOthers && !model.confirmedTypeChange) ||
          (model.ownershipConflicts.length > 0 && !model.migration?.confirmLinkedSnapshots) ||
          Either.isLeft(model.lifecyclePlan) ||
          (Either.isRight(model.lifecyclePlan) &&
            model.lifecyclePlan.right.requiresConfirmation &&
            !model.migration?.confirmRemoval)
        }
        onPress={() => {
          model.saveNote(false);
        }}
      />
      <NativeButton
        label="Save and add another"
        tone="soft"
        disabled={
          locked ||
          Either.isLeft(model.preview) ||
          (model.affectsOthers && !model.confirmedTypeChange) ||
          (model.ownershipConflicts.length > 0 && !model.migration?.confirmLinkedSnapshots) ||
          Either.isLeft(model.lifecyclePlan) ||
          (Either.isRight(model.lifecyclePlan) &&
            model.lifecyclePlan.right.requiresConfirmation &&
            !model.migration?.confirmRemoval)
        }
        onPress={() => {
          model.saveNote(true);
        }}
      />
      {model.message ? <Text accessibilityLiveRegion="polite">{model.message}</Text> : null}
    </View>
  );
}
