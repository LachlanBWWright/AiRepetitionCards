import { Effect, Either } from "effect";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
import type { LiteText } from "mathjax-full/js/adaptors/lite/Text.js";
import type { LiteDocument } from "mathjax-full/js/adaptors/lite/Document.js";
import { HTMLDocument } from "mathjax-full/js/handlers/html/HTMLDocument.js";
import type TexError from "mathjax-full/js/input/tex/TexError.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";

import type { CardMathSvg, CardMathFailure } from "./contracts";
export type { CardMathSvg, CardMathFailure } from "./contracts";
const failure = (): CardMathFailure => ({
  _tag: "CardMathFailure",
  message: "Check this equation's TeX syntax.",
});

function texInput(onFailure: (failure: CardMathFailure) => void) {
  return new TeX<LiteElement, LiteText, LiteDocument>({
    packages: ["base", "ams", "newcommand"],
    maxBuffer: 8000,
    maxMacros: 500,
    formatError: (jax: TeX<LiteElement, LiteText, LiteDocument>, error: TexError) => {
      onFailure({
        _tag: "CardMathFailure",
        message: `Equation: ${error.message.split("\n")[0]?.slice(0, 300) ?? "Check TeX syntax."}`,
      });
      return jax.formatError(error);
    },
  });
}

/** Offline SVG only: no autoload, URLs, HTML, external fonts, or user-supplied extensions. */
export function renderCardMath(
  source: string,
  display = false,
): Either.Either<CardMathSvg, CardMathFailure> {
  if (!source.trim() || source.length > 4000) return Either.left(failure());
  return Effect.runSync(
    Effect.either(
      Effect.try({
        try: (): CardMathSvg | CardMathFailure | undefined => {
          // Each equation gets an isolated parser so macro definitions cannot leak between cards.
          let texFailure: CardMathFailure | undefined;
          const adaptor = liteAdaptor();
          const document = new HTMLDocument<LiteElement, LiteText, LiteDocument>(
            adaptor.parse("", "text/html"),
            adaptor,
            {
              InputJax: texInput((error) => {
                texFailure = error;
              }),
              OutputJax: new SVG<LiteElement, LiteText, LiteDocument>({ fontCache: "none" }),
            },
          );
          const node: unknown = document.convert(source, {
            display,
            em: 20,
            ex: 10,
            containerWidth: 640,
          });
          if (texFailure) return texFailure;
          if (!(node instanceof LiteElement)) return undefined;
          const svg = adaptor.tags(node, "svg")[0];
          if (
            !svg ||
            adaptor.tags(node, "mjx-merror").length ||
            adaptor.outerHTML(svg).includes('data-mml-node="merror"')
          )
            return undefined;
          const bounds: unknown = adaptor.getAttribute(svg, "viewBox");
          if (typeof bounds !== "string") return undefined;
          const viewBox = bounds.split(/\s+/).map(Number);
          const width = viewBox[2];
          const height = viewBox[3];
          if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height))
            return undefined;
          const xml = adaptor.outerHTML(svg).replace(/currentColor/g, "#e6edf8");
          return { svg: xml, width: width / 50, height: height / 50 };
        },
        catch: failure,
      }).pipe(
        Effect.flatMap((result) =>
          !result
            ? Effect.fail(failure())
            : "_tag" in result
              ? Effect.fail(result)
              : Effect.succeed(result),
        ),
      ),
    ),
  );
}

export function cardEquationError(source: string, display = false): string | null {
  if (!source.trim()) return "Enter an equation using TeX notation.";
  if (source.length > 4000) return "Keep the equation within 4,000 characters.";
  const result = renderCardMath(source, display);
  return Either.isLeft(result) ? result.left.message : null;
}
