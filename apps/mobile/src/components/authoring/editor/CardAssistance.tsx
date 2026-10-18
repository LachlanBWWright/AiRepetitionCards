import { Either, Effect } from "effect";
import { createCardAssistanceTutor } from "@recall/application";
import type {
  CardProposal,
  CardRefinementInput,
  CardRefinementResult,
  CardInspectionResult,
} from "@recall/ai-core";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";
import type { deriveCardViews } from "../library/DerivedCardViews";
import { NativeCardAssistancePanel } from "../../tutor/assistance/NativeCardAssistancePanel";

type AssistanceArea = ReturnType<typeof deriveCardViews>["assistanceArea"];
type TutorApi = ReturnType<typeof makeNativeTutorApi>;

export type CardAssistanceProps = {
  readonly editorId: string;
  readonly content: CardProposal | null;
  readonly assistanceArea: AssistanceArea;
  readonly tutorApi: TutorApi | null | undefined;
  readonly disabled: boolean;
  readonly onApply: (
    result: import("@recall/ai-core").CardRefinementResult,
    acceptedKey?: string,
  ) => Promise<boolean>;
  readonly onError: (message: string) => void;
};

export function CardAssistance({
  editorId,
  content,
  assistanceArea,
  tutorApi,
  disabled,
  onApply,
  onError,
}: CardAssistanceProps) {
  if (!content) return null;
  const tutor =
    tutorApi && assistanceArea && Either.isRight(assistanceArea)
      ? createCardAssistanceTutor(tutorApi)
      : null;
  const context =
    assistanceArea && Either.isRight(assistanceArea)
      ? { knowledgeArea: assistanceArea.right, history: [] as const }
      : null;
  const onRefine =
    tutor && context
      ? async (
          mode: CardRefinementInput["mode"],
          instructions: string,
        ): Promise<CardRefinementResult | null> => {
          const result = await Effect.runPromise(
            Effect.either(
              tutor.refine(
                null,
                context,
                { ...content, mode, instructions, sources: [] },
                Date.now(),
              ),
            ),
          );
          if (Either.isLeft(result)) {
            onError(result.left.message);
            return null;
          }
          return result.right.result;
        }
      : undefined;
  const onInspect =
    tutor && context
      ? async (): Promise<CardInspectionResult | null> => {
          const result = await Effect.runPromise(
            Effect.either(tutor.inspect(null, context, { ...content, sources: [] }, Date.now())),
          );
          if (Either.isLeft(result)) {
            onError(result.left.message);
            return null;
          }
          return result.right.result;
        }
      : undefined;
  return (
    <NativeCardAssistancePanel
      key={editorId}
      content={content}
      disabled={disabled}
      onApply={onApply}
      {...(onRefine ? { onRefine } : {})}
      {...(onInspect ? { onInspect } : {})}
    />
  );
}
