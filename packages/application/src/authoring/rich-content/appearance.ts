import type { CardAppearance } from "@recall/domain";

export const DEFAULT_CARD_APPEARANCE: CardAppearance = {
  font: "serif",
  size: "medium",
  align: "left",
  lineSpacing: "comfortable",
};
export const CARD_APPEARANCE_OPTIONS = {
  font: [
    { value: "sans", label: "Sans serif" },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Monospace" },
  ],
  size: [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ],
  align: [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
  ],
  lineSpacing: [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Comfortable" },
  ],
} as const;
export function cardAppearanceMetrics(appearance: CardAppearance) {
  const fontSize = { small: 18, medium: 22, large: 28 }[appearance.size];
  return {
    fontSize,
    lineHeight: fontSize * (appearance.lineSpacing === "compact" ? 1.25 : 1.6),
    textAlign: appearance.align,
  };
}
