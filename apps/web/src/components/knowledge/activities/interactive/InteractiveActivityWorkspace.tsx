import type { ActivityPresentation } from "@recall/application";
import { canonicalMatchingAnswer } from "@recall/application";
import type { ActivityResponse } from "@recall/domain";
import { Button } from "@recall/ui-web";
import { CardRichText } from "../../../cards/CardRichText";
import { OrderingActivity } from "./OrderingActivity";
import { MatchingActivity } from "./MatchingActivity";
import { CodeTracingActivity } from "./CodeTracingActivity";
import { interactiveResponse, readMatchingResponse } from "./interactive-response";

export type InteractiveActivityWorkspaceProps = {
  readonly presentation: ActivityPresentation;
  readonly response: ActivityResponse;
  readonly disabled: boolean;
  readonly onChange: (response: ActivityResponse) => void;
};
/** Receives only the application-validated, shuffled presentation, never the answer key. */
export function InteractiveActivityWorkspace({
  presentation,
  response,
  disabled,
  onChange,
}: InteractiveActivityWorkspaceProps) {
  const game = presentation.interactive;
  if (!game) return null;
  const update = (changes: Partial<Pick<ActivityResponse, "answers" | "selectedOptionIds">>) => {
    onChange(interactiveResponse(response, changes, "seed" in game ? game.seed : undefined));
  };
  const matches = readMatchingResponse(response);
  return (
    <section aria-label="Interactive activity" className="grid gap-4">
      {presentation.prompts.map((prompt, index) => (
        <CardRichText key={index} text={prompt} className="text-sm" />
      ))}
      {game.kind === "ordering" && (
        <OrderingActivity
          items={game.items}
          value={response.selectedOptionIds}
          disabled={disabled}
          onChange={(ids) => {
            update({ selectedOptionIds: ids, answers: [] });
          }}
        />
      )}
      {game.kind === "matching" && (
        <>
          <MatchingActivity
            left={game.left}
            right={game.right}
            answers={matches}
            disabled={disabled}
            onChange={(leftId, rightId) => {
              update({
                answers: [canonicalMatchingAnswer({ ...matches, [leftId]: rightId })],
                selectedOptionIds: [],
              });
            }}
          />
          <Button
            variant="default"
            disabled={disabled || Object.keys(matches).length === 0}
            onClick={() => {
              update({ answers: [], selectedOptionIds: [] });
            }}
          >
            Clear matches
          </Button>
        </>
      )}
      {game.kind === "code-tracing" && (
        <CodeTracingActivity
          code={game.code}
          language={game.language}
          value={response.answers[0] ?? ""}
          disabled={disabled}
          onChange={(answer) => {
            update({ answers: [answer], selectedOptionIds: [] });
          }}
        />
      )}
    </section>
  );
}
