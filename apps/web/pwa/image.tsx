import type { ImgHTMLAttributes } from "react";

type OfflineImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  readonly unoptimized?: boolean;
  readonly priority?: boolean;
};
export default function OfflineImage({ unoptimized, priority, alt, ...props }: OfflineImageProps) {
  return (
    <img
      {...props}
      alt={alt ?? ""}
      loading={priority ? "eager" : props.loading}
      data-unoptimized={unoptimized || undefined}
    />
  );
}
