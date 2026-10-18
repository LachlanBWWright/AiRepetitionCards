import { useCallback, useState } from "react";
export type NativeDeckSharingStudyTime = "any" | "short" | "medium" | "long";
export type NativeDeckSharingDifficulty = "" | "beginner" | "intermediate" | "advanced";

export type NativeDeckSharingBrowseFilters = {
  readonly query: string;
  readonly language: string;
  readonly tag: string;
  readonly difficulty: NativeDeckSharingDifficulty;
  readonly activityType: string;
  readonly studyTime: NativeDeckSharingStudyTime;
};

const initialFilters: NativeDeckSharingBrowseFilters = {
  query: "",
  language: "",
  tag: "",
  difficulty: "",
  activityType: "",
  studyTime: "any",
};

export function useNativeDeckSharingBrowseFilters() {
  const [filters, setFilters] = useState(initialFilters);
  const updateFilter = useCallback(
    <K extends keyof NativeDeckSharingBrowseFilters>(
      key: K,
      value: NativeDeckSharingBrowseFilters[K],
    ) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  return { filters, updateFilter } as const;
}
