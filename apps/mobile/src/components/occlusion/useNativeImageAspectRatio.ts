import { useEffect, useState } from "react";
import { Image } from "react-native";
import { Effect, Either } from "effect";

function imageRatio(uri: string) {
  return Effect.async<number, { readonly _tag: "ImageDimensionsUnavailable" }>((resume) => {
    Image.getSize(
      uri,
      (width, height) => {
        resume(
          height > 0
            ? Effect.succeed(width / height)
            : Effect.fail({ _tag: "ImageDimensionsUnavailable" }),
        );
      },
      () => {
        resume(Effect.fail({ _tag: "ImageDimensionsUnavailable" }));
      },
    );
  });
}
export function useNativeImageAspectRatio(uri: string): number {
  const [dimensions, setDimensions] = useState({ uri: "", ratio: 1 });
  useEffect(() => {
    let active = true;
    void Effect.runPromise(Effect.either(imageRatio(uri))).then((result) => {
      if (active && Either.isRight(result)) setDimensions({ uri, ratio: result.right });
    });
    return () => {
      active = false;
    };
  }, [uri]);
  return dimensions.uri === uri ? dimensions.ratio : 1;
}
