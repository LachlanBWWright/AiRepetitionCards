import { useEffect, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { NativeButton, NativeSelect } from "@recall/ui-native";
import { summarizeSubjects } from "@recall/application";
import { AppSubjectProgress } from "./AppSubjectProgress";
import { AppLibraryPanel } from "./AppLibraryPanel";
import { AppSubjectAI } from "./AppSubjectAI";
import type { AppModel } from "../useAppController";
import { NativeAppTab } from "../../navigation";
const sections = [
  { value: "cards", label: "Cards" },
  { value: "materials", label: "Materials" },
  { value: "progress", label: "Progress" },
] as const;
const modes = [
  { value: "overview", label: "Overview" },
  { value: "review", label: "Review" },
  { value: "tutor", label: "Tutor" },
  { value: "improve", label: "Improve" },
] as const;
export function AppSubjectWorkspace({
  model,
  review,
}: {
  readonly model: AppModel;
  readonly review: ReactNode;
}) {
  useEffect(() => {
    if (
      !model.reviewAll ||
      model.subjectMode !== "review" ||
      model.reviewPending ||
      !model.workspace
    )
      return;
    if (model.activeArea?.cards.some((card) => Date.parse(card.schedule.due) <= model.now)) return;
    const next = summarizeSubjects(model.workspace.areas, [], model.now, "daily").find(
      (row) => row.due > 0,
    );
    if (next) {
      model.startStudy(next.area.id);
      model.setReviewAll(true);
    }
  }, [model]);
  function selectSection(value: string) {
    if (value === "cards" || value === "materials" || value === "progress")
      model.setSubjectSection(value);
  }
  return (
    <View className="flex-1 gap-3">
      <View className="gap-3 px-4 pt-3">
        <NativeButton
          label="Recall / Home"
          tone="soft"
          onPress={() => {
            model.setActiveTab(NativeAppTab.Today);
          }}
        />
        <Text accessibilityRole="header" className="text-2xl font-bold text-recall-ink">
          {model.activeArea?.title ?? "New subject"}
        </Text>
        <NativeSelect
          label="Subject activity"
          value={model.subjectMode}
          options={modes}
          disabled={model.reviewPending}
          onValueChange={(value) => {
            if (value === "review" && model.activeArea) model.startStudy(model.activeArea.id);
            else if (value === "overview" || value === "tutor" || value === "improve")
              model.setSubjectMode(value);
          }}
        />
      </View>
      {model.subjectMode === "review" ? <View className="flex-1">{review}</View> : null}
      {model.subjectMode === "overview" && (
        <View className="px-4">
          <NativeSelect
            label="Overview section"
            value={model.subjectSection}
            options={sections}
            onValueChange={selectSection}
          />
        </View>
      )}
      <ScrollView
        className={
          model.subjectMode !== "overview" || model.subjectSection === "materials"
            ? "hidden"
            : "flex-1"
        }
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-5 p-4">
          <View className={model.subjectMode === "overview" ? "gap-4" : "hidden"}>
            <View className={model.subjectSection === "cards" ? "gap-4" : "hidden"}>
              <AppLibraryPanel key={model.createSubjectRequest} model={model} />
            </View>
            {model.subjectSection === "progress" && <AppSubjectProgress model={model} />}
          </View>
        </View>
      </ScrollView>

      <View
        className={
          model.subjectMode === "tutor" ||
          model.subjectMode === "improve" ||
          (model.subjectMode === "overview" && model.subjectSection === "materials")
            ? "min-h-0 flex-1"
            : "hidden"
        }
      >
        <AppSubjectAI
          key={`${model.tutorScope}:${String(model.operationGeneration)}`}
          model={model}
        />
      </View>
    </View>
  );
}
