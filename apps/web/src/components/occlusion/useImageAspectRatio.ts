import { useEffect, useState } from "react";
import { Effect, Either } from "effect";

function imageRatio(url: string) {
  return Effect.async<number, { readonly _tag: "ImageDimensionsUnavailable" }>((resume) => {
    const image = new Image();
    image.onload = () => {
      resume(
        image.naturalHeight > 0
          ? Effect.succeed(image.naturalWidth / image.naturalHeight)
          : Effect.fail({ _tag: "ImageDimensionsUnavailable" }),
      );
    };
    image.onerror = () => {
      resume(Effect.fail({ _tag: "ImageDimensionsUnavailable" }));
    };
    image.src = url;
    return Effect.sync(() => {
      image.onload = null;
      image.onerror = null;
    });
  });
}
export function useImageAspectRatio(url: string): number {
  const [dimensions, setDimensions] = useState({ url: "", ratio: 1 });
  useEffect(() => {
    let active = true;
    void Effect.runPromise(Effect.either(imageRatio(url))).then((result) => {
      if (active && Either.isRight(result)) setDimensions({ url, ratio: result.right });
    });
    return () => {
      active = false;
    };
  }, [url]);
  return dimensions.url === url ? dimensions.ratio : 1;
}
