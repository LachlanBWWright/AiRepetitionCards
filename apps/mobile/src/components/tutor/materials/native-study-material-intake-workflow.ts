import { Effect, Either } from "effect";
import type { extractNativeOcr } from "../../../storage/materials/native-study-material-ocr";
import type { pickNativeStudyFile } from "../../../storage/materials/native-study-material-files";
import type {
  extractNativeStudyFile,
  extractNativeStudyPaste,
} from "../../../storage/materials/native-study-material-extraction";
import type { NativeStudyMaterialsExtraction } from "./NativeStudyMaterialsPanel.intake";

type Input = {
  readonly name: string;
  readonly paste: string;
  readonly ocrFirst: string;
  readonly ocrLast: string;
};
type Ports = {
  readonly runAction: (operation: (isCurrent: () => boolean) => Promise<void>) => Promise<void>;
  readonly onPreview: (name: string, extraction: NativeStudyMaterialsExtraction) => void;
  readonly onNotice: (notice: string) => void;
  readonly pickFile: typeof pickNativeStudyFile;
  readonly extractFile: typeof extractNativeStudyFile;
  readonly extractPaste: typeof extractNativeStudyPaste;
  readonly ocr: typeof extractNativeOcr;
};
export function createNativeStudyIntakeActions(
  { name, paste, ocrFirst, ocrLast }: Input,
  ports: Ports,
) {
  function checkPaste() {
    const result = Effect.runSync(Effect.either(ports.extractPaste(paste)));
    if (Either.isLeft(result)) ports.onNotice(result.left.message);
    else ports.onPreview(name, result.right);
  }
  function uploadDocument() {
    void ports.runAction(async (isCurrent) => {
      const picked = await Effect.runPromise(Effect.either(ports.pickFile()));
      if (!isCurrent()) return;
      if (Either.isLeft(picked)) {
        ports.onNotice(picked.left.message);
        return;
      }
      if (!picked.right) return;
      const result = await Effect.runPromise(
        Effect.either(ports.extractFile(picked.right.name, picked.right.bytes)),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) ports.onNotice(result.left.message);
      else ports.onPreview(picked.right.name, result.right);
    });
  }
  function uploadScan() {
    void ports.runAction(async (isCurrent) => {
      const first = Number(ocrFirst);
      const last = Number(ocrLast);
      if (
        !Number.isInteger(first) ||
        !Number.isInteger(last) ||
        first < 1 ||
        last < first ||
        last - first >= 20
      ) {
        ports.onNotice("Choose a range of 1–20 pages, starting at page 1 or later.");
        return;
      }
      const picked = await Effect.runPromise(Effect.either(ports.pickFile(true)));
      if (!isCurrent()) return;
      if (Either.isLeft(picked)) {
        ports.onNotice(picked.left.message);
        return;
      }
      if (!picked.right) return;
      ports.onNotice("Reading text…");
      const result = await Effect.runPromise(
        Effect.either(ports.ocr(picked.right.name, picked.right.bytes, first, last)),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) ports.onNotice(result.left.message);
      else {
        ports.onPreview(picked.right.name, result.right);
        ports.onNotice("Check the recognized text before keeping it.");
      }
    });
  }
  return { checkPaste, uploadDocument, uploadScan };
}
