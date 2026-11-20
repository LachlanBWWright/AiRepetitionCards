import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Effect, Either } from "effect";
import { cropImage, trimAudio, inspectMediaFile } from "./browser-media-edit";

export function useMediaEdit(file: File, attach: (file: File) => void) {
  const source = useMemo(() => createObjectUrlStore(file), [file]);
  const lifecycle = useRef<{ readonly file: File; active: boolean } | null>(null);
  useEffect(() => {
    const token = { file, active: true };
    lifecycle.current = token;
    return () => {
      token.active = false;
    };
  }, [file]);
  const preview = useSyncExternalStore(source.subscribe, source.getSnapshot, () => source.empty);
  const url = preview.url;
  const [processingFile, setProcessingFile] = useState<File | null>(null);
  const busy = processingFile === file;
  const [message, setMessage] = useState("");
  const [duration, setDuration] = useState(0);
  const [image, setImage] = useState({ left: 0, top: 0, width: 100, height: 100, maxWidth: 1600 });
  const [audio, setAudio] = useState({ start: 0, end: 0 });
  function apply() {
    if (busy) return;
    const token = lifecycle.current;
    setProcessingFile(file);
    setMessage("");
    const operation = file.type.startsWith("image/")
      ? cropImage(file, image)
      : trimAudio(file, audio);
    void Effect.runPromise(Effect.either(operation)).then((result) => {
      if (!token?.active || token.file !== file) return;
      setProcessingFile(null);
      if (Either.isLeft(result)) setMessage(result.left.message);
      else attach(result.right);
    });
  }
  return {
    url,
    previewMessage: preview.message,
    canEdit: Boolean(url),
    busy,
    message,
    image,
    setImage,
    audio,
    setAudio,
    duration,
    apply,
    loadedAudio: (seconds: number) => {
      if (Number.isFinite(seconds) && seconds > 0) {
        setDuration(seconds);
        setAudio({ start: 0, end: seconds });
      }
    },
  };
}

function createObjectUrlStore(file: File) {
  const empty = { url: "", message: "Checking media before preview…" };
  let current = empty;
  return {
    empty,
    getSnapshot: () => current,
    subscribe: (notify: () => void) => {
      let active = true;
      let url = "";
      void Effect.runPromise(Effect.either(inspectMediaFile(file))).then((result) => {
        if (!active) return;
        if (Either.isRight(result) && result.right) {
          url = URL.createObjectURL(file);
          current = { url, message: "" };
        } else
          current = {
            url: "",
            message:
              "Preview and editing unavailable. Use a still PNG/JPEG/WebP up to 16 megapixels and 8192 pixels per side, or PCM WAV up to 5 minutes, 2 channels and 96 kHz. You can attach the original.",
          };
        notify();
      });
      return () => {
        active = false;
        if (url) URL.revokeObjectURL(url);
      };
    },
  };
}
