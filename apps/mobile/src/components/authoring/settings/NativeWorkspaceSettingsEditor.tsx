import { NativeObjectiveEditor } from "../editor/NativeObjectiveEditor";
import { Text, View } from "react-native";
import { createObjectiveId } from "@recall/domain";
import type { LearningArea } from "@recall/domain";
import { Either } from "effect";
import { parseTagInput } from "@recall/application";
import { NativeButton } from "../../ui/NativeButton";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { ReactNode } from "react";

type SettingsEditor = Extract<Editor, { readonly kind: "settings" }>;
type ObjectiveId = NonNullable<LearningArea["objectives"]>[number]["id"];
type Field = (
  label: string,
  value: string,
  onChangeText: (value: string) => void,
  multiline?: boolean,
  maxLength?: number,
) => ReactNode;
type Submit = (command: unknown, baseline?: string) => void;

export type NativeWorkspaceSettingsEditorProps = {
  readonly editor: SettingsEditor;
  readonly locked: boolean;
  readonly pending: boolean;
  readonly field: Field;
  readonly setEditor: (editor: Editor) => void;
  readonly setMessage: (message: string) => void;
  readonly submit: Submit;
  readonly createId: () => string;
};

export function NativeWorkspaceSettingsEditor({
  editor,
  locked,
  pending,
  field,
  setEditor,
  setMessage,
  submit,
  createId,
}: NativeWorkspaceSettingsEditorProps) {
  function addObjective() {
    setEditor({
      ...editor,
      settings: {
        ...editor.settings,
        objectives: [
          ...editor.settings.objectives,
          {
            id: createObjectiveId(createId()),
            title: "",
            description: null,
            prerequisiteIds: [],
          },
        ],
      },
    });
  }
  function changeObjective(
    objectiveId: ObjectiveId,
    changes: Partial<
      Pick<SettingsEditor["settings"]["objectives"][number], "title" | "description">
    >,
  ) {
    setEditor({
      ...editor,
      settings: {
        ...editor.settings,
        objectives: editor.settings.objectives.map((item) =>
          item.id === objectiveId ? { ...item, ...changes } : item,
        ),
      },
    });
  }
  function togglePrerequisite(objectiveId: ObjectiveId, prerequisiteId: ObjectiveId) {
    setEditor({
      ...editor,
      settings: {
        ...editor.settings,
        objectives: editor.settings.objectives.map((item) => {
          if (item.id !== objectiveId) return item;
          const prerequisiteIds = item.prerequisiteIds.includes(prerequisiteId)
            ? item.prerequisiteIds.filter((id) => id !== prerequisiteId)
            : [...item.prerequisiteIds, prerequisiteId];
          return { ...item, prerequisiteIds };
        }),
      },
    });
  }
  function removeObjective(objectiveId: ObjectiveId) {
    setEditor({
      ...editor,
      settings: {
        ...editor.settings,
        objectives: editor.settings.objectives
          .filter((item) => item.id !== objectiveId)
          .map((item) => ({
            ...item,
            prerequisiteIds: item.prerequisiteIds.filter((id) => id !== objectiveId),
          })),
      },
    });
  }
  return (
    <View className={"gap-[12px] py-[16px] border-t border-recall-line"}>
      <Text className={"text-recall-ink text-[16px] font-bold"}>
        Subject settings and objectives
      </Text>
      {field(
        "Description",
        editor.settings.description ?? "",
        (description) => {
          setEditor({ ...editor, settings: { ...editor.settings, description } });
        },
        true,
      )}
      {field(
        "Language",
        editor.settings.language,
        (language) => {
          setEditor({ ...editor, settings: { ...editor.settings, language } });
        },
        false,
        80,
      )}
      {field(
        "Deck tags (comma separated)",
        editor.tagsText,
        (tagsText) => {
          setEditor({ ...editor, tagsText });
        },
        true,
      )}
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Separate tags with commas. Quote tags containing commas; double embedded quotes inside a
        quoted tag.
      </Text>
      {field(
        "License",
        editor.settings.licence ?? "",
        (licence) => {
          setEditor({ ...editor, settings: { ...editor.settings, licence } });
        },
        false,
        120,
      )}
      {field(
        "Attribution",
        editor.settings.attribution ?? "",
        (attribution) => {
          setEditor({ ...editor, settings: { ...editor.settings, attribution } });
        },
        false,
        500,
      )}
      {field(
        "Tutor instructions",
        editor.settings.ai.tutorInstructions,
        (tutorInstructions) => {
          setEditor({
            ...editor,
            settings: { ...editor.settings, ai: { ...editor.settings.ai, tutorInstructions } },
          });
        },
        true,
        2000,
      )}
      {field(
        "Quiz instructions",
        editor.settings.ai.quizInstructions ?? "",
        (quizInstructions) => {
          setEditor({
            ...editor,
            settings: { ...editor.settings, ai: { ...editor.settings.ai, quizInstructions } },
          });
        },
        true,
        2000,
      )}
      {field(
        "Card generation instructions",
        editor.settings.ai.cardGenerationInstructions ?? "",
        (cardGenerationInstructions) => {
          setEditor({
            ...editor,
            settings: {
              ...editor.settings,
              ai: { ...editor.settings.ai, cardGenerationInstructions },
            },
          });
        },
        true,
        2000,
      )}
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        AI instructions guide proposals; generated cards still require approval.
      </Text>
      {editor.settings.objectives.map((objective) => (
        <NativeObjectiveEditor
          key={objective.id}
          objective={objective}
          objectives={editor.settings.objectives}
          field={field}
          locked={locked}
          onChange={changeObjective}
          onTogglePrerequisite={togglePrerequisite}
          onRemove={removeObjective}
        />
      ))}
      {
        <NativeButton
          label={"Add objective"}
          tone="soft"
          disabled={locked}
          onPress={addObjective}
        />
      }
      {
        <NativeButton
          label={pending ? "Saving…" : "Save settings"}
          tone="soft"
          disabled={locked}
          onPress={() => {
            const tags = parseTagInput(editor.tagsText);
            if (Either.isLeft(tags)) {
              setMessage(tags.left.message);
              return;
            }
            submit(
              {
                kind: "update-area-settings",
                areaId: editor.areaId,
                settings: { ...editor.settings, tags: tags.right },
              },
              editor.baseline,
            );
          }}
        />
      }
    </View>
  );
}
