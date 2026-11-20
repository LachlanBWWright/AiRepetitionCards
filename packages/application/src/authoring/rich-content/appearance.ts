import type { CardAppearance, ReviewPresentation } from "@recall/domain";

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
    { value: "right", label: "Right" },
  ],
  direction: [
    { value: "auto", label: "Automatic" },
    { value: "ltr", label: "Left to right" },
    { value: "rtl", label: "Right to left" },
  ],
  imageSize: [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
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

export const CARD_LAYOUT_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly appearance: CardAppearance;
}[] = [
  { id: "reading", label: "Comfortable reading", appearance: DEFAULT_CARD_APPEARANCE },
  {
    id: "focus",
    label: "Large centered",
    appearance: { font: "sans", size: "large", align: "center", lineSpacing: "comfortable" },
  },
  {
    id: "code",
    label: "Compact code",
    appearance: {
      font: "mono",
      size: "small",
      align: "left",
      lineSpacing: "compact",
      direction: "ltr",
    },
  },
  {
    id: "rtl",
    label: "Right-to-left reading",
    appearance: {
      font: "sans",
      size: "medium",
      align: "right",
      lineSpacing: "comfortable",
      direction: "rtl",
    },
  },
];
export function cardFieldAppearance(
  presentation: ReviewPresentation | undefined,
  field: "front" | "back" | "explanation",
): CardAppearance | undefined {
  return presentation?.fieldAppearance?.[field] ?? presentation?.appearance;
}
export function cardImageSize(appearance: CardAppearance | undefined): number {
  return { small: 160, medium: 280, large: 480 }[appearance?.imageSize ?? "medium"];
}
