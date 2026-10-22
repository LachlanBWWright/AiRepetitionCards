import type { TutorTokenUsage } from "@recall/ai-core";

export type ChatModelSelection = {
  readonly usage?: TutorTokenUsage | null | undefined;
  readonly models: readonly { readonly slug: string; readonly displayName: string }[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
};
