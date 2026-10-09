import type { ImgHTMLAttributes } from "react";

/** Renders a local or user-provided image without requiring a Next.js image server. */
export function InlineImage(
  props: Omit<ImgHTMLAttributes<HTMLImageElement>, "alt"> & { alt: string },
) {
  const { alt, ...imageProps } = props;
  return <img alt={alt} {...imageProps} />;
}
