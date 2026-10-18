import type { LearningArea, ReviewEvent } from "@recall/domain";

export const subjectSortOptions = [
  { value: "daily", label: "Daily priority" },
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently studied" },
  { value: "due", label: "Due count" },
] as const;
export type SubjectSort = (typeof subjectSortOptions)[number]["value"];
export function isSubjectSort(value: string): value is SubjectSort {
  return subjectSortOptions.some((option) => option.value === value);
}
export type SubjectSummary = {
  readonly area: LearningArea;
  readonly due: number;
  readonly oldestDue: number;
  readonly lastStudied: number;
  readonly suggested: boolean;
};

/** Derived ordering only: never changes schedules, review history, or the input collection. */
export function summarizeSubjects(
  areas: readonly LearningArea[],
  events: readonly ReviewEvent[],
  now: number,
  sort: SubjectSort,
  suggestedAreaIds: readonly string[] = [],
  search = "",
): readonly SubjectSummary[] {
  const lastStudied = new Map<string, number>();
  for (const event of events) {
    const time = Date.parse(event.ratedAt);
    lastStudied.set(event.areaId, Math.max(lastStudied.get(event.areaId) ?? 0, time));
  }
  const query = search.trim().toLocaleLowerCase();
  const rows = areas
    .filter((area) => area.title.toLocaleLowerCase().includes(query))
    .map((area) => {
      const dueTimes = area.cards
        .map((card) => Date.parse(card.schedule.due))
        .filter((time) => time <= now);
      return {
        area,
        due: dueTimes.length,
        oldestDue: Math.min(...dueTimes, Infinity),
        lastStudied: lastStudied.get(area.id) ?? 0,
        suggested: suggestedAreaIds.includes(area.id),
      };
    });
  return rows.sort((left, right) => {
    const name =
      left.area.title.localeCompare(right.area.title, "en") ||
      left.area.id.localeCompare(right.area.id, "en");
    if (sort === "name") return name;
    if (sort === "recent") return right.lastStudied - left.lastStudied || name;
    if (sort === "due") return right.due - left.due || name;
    if (left.due || right.due) {
      return (
        Number(right.due > 0) - Number(left.due > 0) || left.oldestDue - right.oldestDue || name
      );
    }
    return Number(right.suggested) - Number(left.suggested) || name;
  });
}

export type SubjectActivity = "overview" | "review" | "tutor" | "improve";
export function isSubjectActivity(value: string): value is SubjectActivity {
  return value === "overview" || value === "review" || value === "tutor" || value === "improve";
}
