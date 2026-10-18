export const DEFAULT_TUTOR_MODEL = "gpt-6-luna";

/** Select only a model advertised by the account; retain a valid user selection. */
export function selectTutorModel(
  models: readonly { readonly slug: string }[],
  selected = "",
): string {
  if (selected && models.some((model) => model.slug === selected)) return selected;
  return models.find((model) => model.slug === DEFAULT_TUTOR_MODEL)?.slug ?? models[0]?.slug ?? "";
}
