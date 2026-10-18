import { useCallback, useState } from "react";

export type DeckSharingBrowseFilters = {
  readonly query: string;
  readonly language: string;
  readonly tag: string;
  readonly difficulty: "" | "beginner" | "intermediate" | "advanced";
  readonly activityType: string;
  readonly studyTime: "any" | "short" | "medium" | "long";
};

const initialFilters: DeckSharingBrowseFilters = {
  query: "",
  language: "",
  tag: "",
  difficulty: "",
  activityType: "",
  studyTime: "any",
};

export function useDeckSharingBrowseFilters() {
  const [filters, setFilters] = useState(initialFilters);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const updateFilter = useCallback(
    <K extends keyof DeckSharingBrowseFilters>(key: K, value: DeckSharingBrowseFilters[K]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );
  const clearFilters = useCallback(() => {
    setFilters(initialFilters);
  }, []);

  return { filters, updateFilter, clearFilters, ownedOnly, setOwnedOnly } as const;
}
