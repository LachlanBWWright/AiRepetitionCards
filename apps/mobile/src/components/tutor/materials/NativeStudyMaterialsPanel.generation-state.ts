import { useState } from "react";
import type { GenerationDepth } from "./NativeStudyMaterialsPanel.generate";

export function useNativeStudyMaterialsGenerationState() {
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [depth, setDepth] = useState<GenerationDepth>("standard");
  const [count, setCount] = useState("10");
  const [showGenerationSettings, setShowGenerationSettings] = useState(false);
  return {
    conceptId,
    setConceptId,
    depth,
    setDepth,
    count,
    setCount,
    showGenerationSettings,
    setShowGenerationSettings,
  } as const;
}
