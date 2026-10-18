import { useState } from "react";
import { Text, View } from "react-native";
import { NativeButton, NativeSelect, NativeTextField } from "@recall/ui-native";
import {
  summarizeSubjects,
  subjectSortOptions,
  isSubjectSort,
  type SubjectSort,
} from "@recall/application";
import { NativeAppTab, type SubjectMode } from "../../navigation";
import type { AppModel } from "../useAppController";
export function AppSubjectsHome({ model }: { readonly model: AppModel }) {
  const [sort, setSort] = useState<SubjectSort>("daily");
  const [search, setSearch] = useState("");
  const rows = summarizeSubjects(
    model.workspace?.areas ?? [],
    model.workspace?.reviewEvents ?? [],
    model.now,
    sort,
    model.deepPracticeRecommendations.map((item) => item.activity.areaId),
    search,
  );
  const due = (model.workspace?.areas ?? []).reduce(
    (count, area) =>
      count + area.cards.filter((card) => Date.parse(card.schedule.due) <= model.now).length,
    0,
  );
  function open(id: string, mode: SubjectMode) {
    if (model.reviewPending) return;
    if (mode === "review") model.startStudy(id);
    else {
      model.setActiveAreaId(id);
      model.setSubjectMode(mode);
      model.setActiveTab(NativeAppTab.Library);
    }
  }
  return (
    <View className="gap-5">
      <Text accessibilityRole="header" className="text-3xl font-bold text-recall-ink">
        Your subjects
      </Text>
      <Text className="text-sm text-recall-muted">
        {due} cards due · {model.workspace?.areas.length ?? 0} subjects
      </Text>
      {model.message && (
        <Text accessibilityLiveRegion="polite" className="text-recall-muted">
          {model.message}
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        <NativeButton
          label="New subject"
          disabled={model.reviewPending}
          onPress={() => {
            model.setSubjectMode("overview");
            model.setSubjectSection("cards");
            model.setCreateSubjectRequest((value) => value + 1);
            model.setActiveTab(NativeAppTab.Library);
          }}
        />
        <NativeButton
          label="Import cards"
          tone="soft"
          onPress={() => {
            model.setSubjectMode("overview");
            model.setShowImportChoices(true);
            model.setActiveTab(NativeAppTab.Library);
          }}
        />
        <NativeButton
          label="Browse shared decks"
          tone="soft"
          onPress={() => {
            model.setActiveTab(NativeAppTab.Sharing);
          }}
        />
      </View>
      <NativeButton
        label="Review all due"
        disabled={model.reviewPending || due === 0}
        onPress={() => {
          const next = summarizeSubjects(model.workspace?.areas ?? [], [], model.now, "daily").find(
            (row) => row.due > 0,
          );
          if (next) {
            model.startStudy(next.area.id);
            model.setReviewAll(true);
          }
        }}
      />
      <NativeTextField label="Find a subject" value={search} onChangeText={setSearch} />
      <NativeSelect
        label="Sort subjects"
        value={sort}
        options={subjectSortOptions}
        onValueChange={(value) => {
          if (isSubjectSort(value)) setSort(value);
        }}
      />
      {rows.map((row) => (
        <View key={row.area.id} className="gap-3 rounded-xl border border-recall-line p-4">
          <NativeButton
            label={row.area.title}
            tone="soft"
            disabled={model.reviewPending}
            onPress={() => {
              open(row.area.id, "overview");
            }}
          />
          <Text className="text-sm text-recall-muted">
            {row.area.cards.length} cards · {row.due} due
            {row.suggested ? " · Follow-up available" : ""}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <NativeButton
              label="Review"
              disabled={model.reviewPending || row.due === 0}
              onPress={() => {
                open(row.area.id, "review");
              }}
            />
            <NativeButton
              label="Tutor"
              tone="soft"
              disabled={model.reviewPending}
              onPress={() => {
                open(row.area.id, "tutor");
              }}
            />
            <NativeButton
              label="Improve"
              tone="soft"
              disabled={model.reviewPending}
              onPress={() => {
                open(row.area.id, "improve");
              }}
            />
          </View>
        </View>
      ))}
      {rows.length === 0 && (
        <Text className="text-recall-muted">
          {search
            ? "No matching subjects."
            : "Create a subject with just a name. Add cards or materials whenever you’re ready."}
        </Text>
      )}
    </View>
  );
}
