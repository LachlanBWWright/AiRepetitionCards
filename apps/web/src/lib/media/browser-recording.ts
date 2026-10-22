import { Effect } from "effect";
export type RecordingFailure = { readonly _tag: "RecordingFailure"; readonly message: string };
export type BrowserRecording = {
  readonly stop: Effect.Effect<File, RecordingFailure>;
  readonly cancel: Effect.Effect<void>;
};
export function startBrowserRecording(): Effect.Effect<BrowserRecording, RecordingFailure> {
  return Effect.tryPromise({
    try: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    catch: (): RecordingFailure => ({
      _tag: "RecordingFailure",
      message: "Microphone access failed. Allow access and try again.",
    }),
  }).pipe(
    Effect.flatMap((stream) =>
      Effect.try({
        try: () => {
          const mimeType = ["audio/webm", "audio/mp4", "audio/ogg"].find((mime) =>
            MediaRecorder.isTypeSupported(mime),
          );
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          const chunks: Blob[] = [];
          const release = () => {
            stream.getTracks().forEach((track) => {
              track.stop();
            });
          };
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.start();
          const stop = Effect.async<File, RecordingFailure>((resume) => {
            recorder.onstop = () => {
              release();
              const type = recorder.mimeType.split(";")[0] ?? "audio/webm";
              resume(Effect.succeed(new File(chunks, "pronunciation", { type })));
            };
            recorder.onerror = () => {
              release();
              resume(
                Effect.fail({ _tag: "RecordingFailure", message: "Recording failed. Try again." }),
              );
            };
            recorder.stop();
          });
          return {
            stop,
            cancel: Effect.sync(() => {
              if (recorder.state !== "inactive") recorder.stop();
              release();
            }),
          };
        },
        catch: (): RecordingFailure => {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return {
            _tag: "RecordingFailure",
            message: "Audio recording is unavailable in this browser.",
          };
        },
      }),
    ),
  );
}
