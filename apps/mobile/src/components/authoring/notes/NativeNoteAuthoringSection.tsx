import { useState } from "react";
import { View } from "react-native";
import { Effect } from "effect";
import type { NativeWorkspaceAuthoringPanelProps } from "../NativeWorkspaceAuthoringPanel.types";
import { NativeButton } from "../../ui/NativeButton";
import { NativeNoteLibraryEditor } from "./NativeNoteLibraryEditor";

type Props = Pick<
  NativeWorkspaceAuthoringPanelProps,
  | "workspace"
  | "activeAreaId"
  | "onCommand"
  | "createId"
  | "disabled"
  | "onPickAttachment"
  | "notes"
  | "notesLoaded"
  | "onRetainNoteDraft"
  | "onDiscardNoteDraft"
> & { readonly initialNoteId?: string | undefined };
export function NativeNoteAuthoringSection(props: Props) {
  const [open, setOpen] = useState(Boolean(props.initialNoteId));
  const area =
    props.workspace?.areas.find((item) => item.id === props.activeAreaId) ??
    props.workspace?.areas[0];
  if (!props.workspace || !area || props.notesLoaded === false) return null;
  const draftPort =
    props.onRetainNoteDraft && props.onDiscardNoteDraft
      ? {
          drafts: props.notes?.noteDrafts ?? [],
          retain: props.onRetainNoteDraft,
          discard: props.onDiscardNoteDraft,
        }
      : undefined;
  return (
    <View className="gap-3">
      {!props.initialNoteId && (
        <NativeButton
          label={open ? "Hide shared note editor ▴" : "Create or edit shared notes ▾"}
          tone="soft"
          disabled={props.disabled ?? false}
          onPress={() => {
            setOpen(!open);
          }}
        />
      )}
      {(open || Boolean(props.initialNoteId)) && (
        <NativeNoteLibraryEditor
          key={`${area.id}:${props.initialNoteId ?? "new"}`}
          workspace={props.workspace}
          area={area}
          save={(command, baseline, assets) =>
            Effect.tryPromise({
              try: () => props.onCommand(command, baseline, assets),
              catch: () => ({
                message: "The note could not be saved. Retry after checking storage.",
              }),
            }).pipe(
              Effect.flatMap((result) =>
                result.ok ? Effect.succeed(result) : Effect.fail({ message: result.message }),
              ),
            )
          }
          pickAttachment={props.onPickAttachment}
          draftPort={draftPort}
          createId={props.createId}
          initialNoteId={props.initialNoteId}
          disabled={props.disabled ?? false}
        />
      )}
    </View>
  );
}
