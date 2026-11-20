import { NativeSubjectSummaryRow } from "./NativeSubjectSummaryRow";
import { NativeDailyReviewSummary } from "./NativeDailyReviewSummary";
import { NativeSubjectTree } from "./NativeSubjectTree";
import { useState } from "react";
import { Text, View } from "react-native";
import { NativeButton, NativeCollapsible, NativeSelect, NativeTextField } from "@recall/ui-native";
import {
  summarizeStudySubjects,
  nextStudyArea,
  subjectSortOptions,
  isSubjectSort,
  type SubjectSort,
} from "@recall/application";
import { NativeAppTab, type SubjectMode } from "../../navigation";
import type { AppModel } from "../useAppController";
export function AppSubjectsHome({ model }: { readonly model: AppModel }) {
  const [sort, setSort] = useState<SubjectSort>("daily");
  const [search, setSearch] = useState("");
  const [showActions, setShowActions] = useState(false);
  const rows = model.workspace
    ? summarizeStudySubjects(
        model.workspace,
        model.now,
        sort,
        model.deepPracticeRecommendations.map((item) => item.activity.areaId),
        search,
      )
    : [];
  const due = model.workspace
    ? summarizeStudySubjects(model.workspace, model.now).reduce((total, row) => total + row.due, 0)
    : 0;
  function open(id: string, mode: SubjectMode) {
    if (model.reviewPending) return;
    if (mode === "review") model.startStudy(id);
    else {
      model.setActiveAreaId(id);
      model.setSubjectMode(mode);
      model.setActiveTab(NativeAppTab.Library);
    }
  }
  function createSubject() {
    model.setSubjectMode("overview");
    model.setSubjectSection("cards");
    model.setCreateSubjectRequest((value) => value + 1);
    model.setActiveTab(NativeAppTab.Library);
  }
  function handleEmptyAction() {
    if (search) setSearch("");
    else createSubject();
  }
  return (
    <View className="gap-6">
      <Text accessibilityRole="header" className="text-3xl font-bold text-recall-ink">
        Your subjects
      </Text>
      <Text className="text-sm text-recall-muted">
        {model.workspace?.areas.length ?? 0} subjects
      </Text>
      {model.message && (
        <Text accessibilityLiveRegion="polite" className="text-recall-muted">
          {model.message}
        </Text>
      )}
      {Boolean(model.workspace?.areas.length) && (
        <NativeDailyReviewSummary
          due={due}
          disabled={model.reviewPending || due === 0}
          onReview={() => {
            const next = model.workspace ? nextStudyArea(model.workspace, model.now) : undefined;
            if (next) {
              model.startStudy(next.id);
              model.setReviewAll(true);
            }
          }}
        />
      )}
      {model.workspace && (
        <NativeSubjectTree
          workspace={model.workspace}
          disabled={model.reviewPending}
          onOpen={(id) => {
            open(id, "overview");
          }}
          onStudy={(id) => {
            open(id, "review");
          }}
        />
      )}
      {Boolean(model.workspace?.areas.length) && (
        <>
          <NativeTextField label="Find a subject" value={search} onChangeText={setSearch} />
          <NativeSelect
            label="Sort subjects"
            value={sort}
            options={subjectSortOptions}
            onValueChange={(value) => {
              if (isSubjectSort(value)) setSort(value);
            }}
          />
        </>
      )}
      {rows.map((row) => (
        <NativeSubjectSummaryRow
          key={row.area.id}
          row={row}
          disabled={model.reviewPending}
          onOpen={(activity) => {
            open(row.area.id, activity);
          }}
        />
      ))}
      <NativeCollapsible
        title="Subject actions"
        open={showActions}
        onToggle={() => {
          setShowActions((current) => !current);
        }}
      >
        <View className="gap-2">
          <NativeButton
            label="New subject"
            disabled={model.reviewPending}
            onPress={createSubject}
          />
          <NativeButton
            label="Import cards"
            variant="secondary"
            onPress={() => {
              model.setSubjectMode("overview");
              model.setShowImportChoices(true);
              model.setActiveTab(NativeAppTab.Library);
            }}
          />
          <NativeButton
            label="Browse shared decks"
            variant="secondary"
            onPress={() => {
              model.setActiveTab(NativeAppTab.Sharing);
            }}
          />
        </View>
      </NativeCollapsible>
      {rows.length === 0 && (
        <View className="gap-4 py-6">
          <Text className="text-recall-ink text-lg font-semibold">
            {search ? "No matching subjects" : "Create your first subject"}
          </Text>
          <Text className="text-sm leading-6 text-recall-muted">
            {search
              ? "No matching subjects."
              : "Choose something you’re learning. Give it a name, then add your first card."}
          </Text>
          <NativeButton
            label={search ? "Clear search" : "New subject"}
            disabled={model.reviewPending}
            onPress={handleEmptyAction}
          />
        </View>
      )}
    </View>
  );
}
