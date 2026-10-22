import type { Effect } from "effect";
import type {
  AreaSettings,
  CardContent,
  LibraryDraft,
  LibraryNotes,
  NoteAuthoringDraft,
  WorkspaceSearchResult,
} from "@recall/application";
import type { Assessment, LearningArea, Workspace, SchedulerSettings } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import type { makeNativeTutorApi } from "../../storage/ai/native-tutor-api";

export type Editor =
  | {
      readonly kind: "scheduler";
      readonly retentionPercent: string;
      readonly settings: SchedulerSettings;
      readonly dailyNewLimit: string;
      readonly leechThreshold: string;
      readonly baseline?: string;
    }
  | {
      readonly kind: "area";
      readonly mode: "create" | "edit";
      readonly id: string;
      readonly title: string;
      readonly color: string;
      readonly baseline?: string;
    }
  | {
      readonly kind: "card";
      readonly mode: "create" | "edit";
      readonly areaId: string;
      readonly id: string;
      readonly content: CardContent;
      readonly stagedAssets: readonly StoredMediaAsset[];
      readonly tagsText: string;
      readonly baseline?: string;
      readonly sourceCard?: Assessment;
    }
  | {
      readonly kind: "settings";
      readonly areaId: string;
      readonly settings: AreaSettings;
      readonly tagsText: string;
      readonly baseline?: string;
    }
  | {
      readonly kind: "delete";
      readonly command: unknown;
      readonly title: string;
      readonly baseline?: string;
    };

export type NativeWorkspaceAuthoringPanelProps = {
  readonly mediaStore?: MediaStore | null;
  readonly hideAreaPicker?: boolean;
  readonly flaggedOnly?: boolean;
  readonly onFlaggedFilterChange?: (value: boolean) => void;
  readonly notes?: LibraryNotes;
  readonly notesLoaded?: boolean;
  readonly onFlushDraft?: () => Promise<boolean>;
  readonly onRetainNoteDraft?: (
    draft: NoteAuthoringDraft,
    assets: readonly StoredMediaAsset[],
  ) => void;
  readonly onDiscardNoteDraft?: (key: string) => void;
  readonly onRetainDraft?: (draft: LibraryDraft, assets?: readonly StoredMediaAsset[]) => void;
  readonly onDiscardDraft?: (key: string) => void;
  readonly onFlag?: (id: string) => void;
  readonly onSelectDeck?: (id: string) => void;
  readonly onGenerateCards?: () => void;
  readonly onStudy?: (areaId: string) => void;
  readonly onImportCards?: () => void;
  readonly now?: number;
  readonly workspace: Workspace | null;
  readonly activeAreaId: string | null;
  readonly tutorApi?: ReturnType<typeof makeNativeTutorApi> | null;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly createId: () => string;
  readonly onCommand: (
    command: unknown,
    expectedBaseline?: string,
    assets?: readonly StoredMediaAsset[],
  ) => Promise<{ readonly ok: boolean; readonly message: string }>;
  readonly onPickAttachment?: () => Effect.Effect<
    StoredMediaAsset | null,
    { readonly message: string }
  >;
  readonly initialEditor?:
    | "create-area"
    | "edit-area"
    | "edit-card"
    | "basic"
    | "cloze"
    | "settings"
    | "scheduler"
    | "delete-area"
    | "delete-card";
  readonly initialMessage?: string;
  readonly initialObjectiveFilter?: string;
  readonly initialSearch?: string;
  readonly initialShowDuplicates?: boolean;
  readonly initialHistory?: boolean;
  readonly searchTarget?: WorkspaceSearchResult | null;
};

export const settingsFor = (area: LearningArea): AreaSettings => ({
  description: area.description ?? null,
  language: area.language ?? "English",
  tags: area.tags ?? [],
  licence: area.licence ?? null,
  attribution: area.attribution ?? null,
  ai: area.ai ?? {
    tutorInstructions: "",
    quizInstructions: null,
    cardGenerationInstructions: null,
  },
  objectives: area.objectives ?? [],
});

export const emptyContent: CardContent = {
  kind: "basic",
  front: "",
  back: "",
  objectiveIds: [],
  tags: [],
  media: [],
};
