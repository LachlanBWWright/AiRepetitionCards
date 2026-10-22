export type CardMathSvg = {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
};
export type CardMathFailure = {
  readonly _tag: "CardMathFailure";
  readonly message: string;
};
