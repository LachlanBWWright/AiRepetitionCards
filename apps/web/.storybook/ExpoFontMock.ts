/** Native font loading is supplied by the device; Storybook uses its browser fonts. */
export function useFonts() {
  return [true, null] as const;
}
