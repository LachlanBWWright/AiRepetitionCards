import { useMemo } from "react";
import { Either } from "effect";
import { renderCardMath } from "@recall/infra-rich-content";

export function CardEquation({
  source,
  display = false,
  fontSize = 20,
}: {
  readonly source: string;
  readonly display?: boolean;
  readonly fontSize?: number;
}) {
  const result = useMemo(() => renderCardMath(source, display), [source, display]);
  return Either.isRight(result) ? (
    <span
      role="math"
      aria-label={source}
      className={
        display
          ? "my-3 block max-w-full overflow-x-auto"
          : "inline-block max-w-full align-middle overflow-x-auto"
      }
    >
      <svg
        aria-hidden="true"
        width={(result.right.width * fontSize) / 20}
        height={(result.right.height * fontSize) / 20}
        className="inline-block"
      >
        <image
          href={`data:image/svg+xml,${encodeURIComponent(result.right.svg)}`}
          width="100%"
          height="100%"
        />
      </svg>
    </span>
  ) : (
    <code title={result.left.message}>{source}</code>
  );
}
