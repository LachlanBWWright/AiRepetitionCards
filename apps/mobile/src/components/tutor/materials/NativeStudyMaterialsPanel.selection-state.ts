import { useEffect, useState } from "react";
import type { WorkspaceSearchTarget } from "@recall/application";

type PassageDraft = { readonly sectionId: string; readonly text: string };

export function useNativeStudyMaterialsSelectionState(
  searchTarget: WorkspaceSearchTarget | undefined,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPassage, setShowPassage] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [passageDraft, setPassageDraft] = useState<PassageDraft | null>(null);
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const [targetClaimId, setTargetClaimId] = useState<string | null>(null);

  useEffect(() => {
    if (
      !searchTarget ||
      (searchTarget.kind !== "material" &&
        searchTarget.kind !== "passage" &&
        searchTarget.kind !== "claim")
    )
      return;
    const frame = requestAnimationFrame(() => {
      setSelectedId(searchTarget.materialId);
      if (searchTarget.kind === "passage" || searchTarget.kind === "claim") {
        setSectionId(searchTarget.sectionId);
        setShowPassage(true);
      }
      if (searchTarget.kind === "claim") setExpandedClaimId(searchTarget.claimId);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [searchTarget]);

  return {
    selectedId,
    setSelectedId,
    showPassage,
    setShowPassage,
    sectionId,
    setSectionId,
    passageDraft,
    setPassageDraft,
    expandedClaimId,
    setExpandedClaimId,
    targetClaimId,
    setTargetClaimId,
  } as const;
}
