import { effectiveReviewEvents } from "@recall/domain";
import type { Workspace } from "@recall/domain";
import { summarizeSubjects, type SubjectSort } from "../subjects/subject-home";
import { studyScope } from "./presets/resolve-settings";
import { localStudyDay, studyQueue } from "./study-queue";

/** Queue-aware summaries retain the full subject content for navigation and rendering. */
export function summarizeStudySubjects(
  workspace: Workspace,
  now: number,
  sort: SubjectSort = "daily",
  suggestedAreaIds: readonly string[] = [],
  search = "",
) {
  const day = localStudyDay(now);
  const originals = new Map(workspace.areas.map((area) => [area.id, area]));
  const eligible = workspace.areas.map((area) => ({
    ...area,
    cards: studyQueue(workspace, area, now, day).cards,
  }));
  return summarizeSubjects(
    eligible,
    effectiveReviewEvents(workspace),
    now,
    sort,
    suggestedAreaIds,
    search,
  ).map((row) => ({ ...row, area: originals.get(row.area.id) ?? row.area }));
}
export function nextStudyArea(workspace: Workspace, now: number, excludeAreaId?: string) {
  return summarizeStudySubjects(workspace, now).find(
    (row) => row.due > 0 && row.area.id !== excludeAreaId,
  )?.area;
}
export function reviewElapsedMs(startedAt: number, now: number): number {
  return Math.round(Math.max(0, Math.min(60_000, now - startedAt)));
}

/** Parent sessions select an original child area, never synthesize or move cards. */
export function studySessionArea(workspace: Workspace, selection: string, now: number) {
  if (!selection.startsWith("scope:")) return workspace.areas.find((area) => area.id === selection);
  const parentId = selection.slice(6);
  const members = new Set(studyScope(workspace, parentId));
  const day = localStudyDay(now);
  const candidates = workspace.areas.filter((area) => members.has(area.id));
  return (
    candidates.find((area) =>
      studyQueue(workspace, area, now, day).cards.some(
        (card) => card.schedule.state === 1 || card.schedule.state === 3,
      ),
    ) ??
    candidates.find((area) => studyQueue(workspace, area, now, day).cards.length > 0) ??
    candidates.find((area) => area.id === parentId)
  );
}

export function studySubjectTree(workspace: Workspace) {
  const areas = new Map(workspace.areas.map((area) => [String(area.id), area]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const area of workspace.areas) {
    const parent = workspace.schedulerSettings?.areaParents?.[area.id];
    if (!parent || !areas.has(parent)) roots.push(area.id);
    else children.set(parent, [...(children.get(parent) ?? []), area.id]);
  }
  const rows: {
    readonly area: Workspace["areas"][number];
    readonly depth: number;
    readonly hasChildren: boolean;
  }[] = [];
  const seen = new Set<string>();
  // A fallback pass also exposes disconnected cycles in an unsaved settings draft.
  const pending = [...new Set([...roots, ...areas.keys()])]
    .reverse()
    .map((id) => ({ id, depth: 0 }));
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    const area = areas.get(item.id);
    if (!area) continue;
    const descendants = children.get(item.id) ?? [];
    rows.push({ area, depth: item.depth, hasChildren: descendants.length > 0 });
    pending.push(...[...descendants].reverse().map((id) => ({ id, depth: item.depth + 1 })));
  }
  return rows;
}

/** Group progress includes hidden descendant backlog while cards retain their source area. */
export function studySessionQueue(
  workspace: Workspace,
  selection: string,
  area: Workspace["areas"][number],
  now: number,
) {
  const day = localStudyDay(now);
  const queue = studyQueue(workspace, area, now, day);
  if (!selection.startsWith("scope:")) return queue;
  const scope = new Set(studyScope(workspace, selection.slice(6)));
  const queues = workspace.areas
    .filter((item) => scope.has(item.id))
    .map((item) => studyQueue(workspace, item, now, day));
  return {
    ...queue,
    dueCount: queues.reduce((sum, item) => sum + item.dueCount, 0),
    deferredReviewCount: queues.reduce((sum, item) => sum + item.deferredReviewCount, 0),
    deferredNewCount: queues.reduce((sum, item) => sum + item.deferredNewCount, 0),
    buriedCount: queues.reduce((sum, item) => sum + item.buriedCount, 0),
    filteredCount: queues.reduce((sum, item) => sum + item.filteredCount, 0),
  };
}
