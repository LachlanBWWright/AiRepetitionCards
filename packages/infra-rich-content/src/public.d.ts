import type { Either } from "effect";
import type { CardMathFailure, CardMathSvg } from "./contracts";
export type { CardMathFailure, CardMathSvg } from "./contracts";

/** Vendor-independent public boundary; MathJax types stay inside this infrastructure package. */
export declare function renderCardMath(
  source: string,
  display?: boolean,
): Either.Either<CardMathSvg, CardMathFailure>;
