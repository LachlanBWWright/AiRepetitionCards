import type { RefObject } from "react";
import { Button, Input, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import type { StudyOcrProgress } from "@/lib/study-material-ocr";
import { StudyMaterialsPanelImport } from "./StudyMaterialsPanelImport";

export type StudyMaterialsPanelPasteProps = {
  readonly disabled: boolean;
  readonly name: string;
  readonly text: string;
  readonly onNameChange: (value: string) => void;
  readonly onTextChange: (value: string) => void;
  readonly onPaste: () => void;
  readonly fileInput: RefObject<HTMLInputElement | null>;
  readonly importing: boolean;
  readonly ocrScans: boolean;
  readonly onOcrScansChange: (enabled: boolean) => void;
  readonly ocrProgress: StudyOcrProgress | null;
  readonly onFileSelected: (file: File) => void;
  readonly onCancelImport: () => void;
};

export function StudyMaterialsPanelPaste({
  disabled,
  name,
  text,
  onNameChange,
  onTextChange,
  onPaste,
  fileInput,
  importing,
  ocrScans,
  onOcrScansChange,
  ocrProgress,
  onFileSelected,
  onCancelImport,
}: StudyMaterialsPanelPasteProps) {
  return (
    <section className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-6">
      <div className="flex flex-col min-w-0 content-start gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="study-material-name">Material name</Label>
          <Input
            id="study-material-name"
            disabled={disabled}
            value={name}
            maxLength={200}
            placeholder="e.g. Biology lecture notes"
            onChange={(event) => {
              onNameChange(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="study-material-text">Paste study text</Label>
          <Textarea
            id="study-material-text"
            disabled={disabled}
            value={text}
            className="min-h-48 resize-y leading-6"
            maxLength={500000}
            onChange={(event) => {
              onTextChange(event.target.value);
            }}
            placeholder="Paste lecture notes, a chapter, or code examples…"
          />
        </div>
        <Button
          type="button"
          variant="default"
          className="w-full sm:w-fit"
          disabled={disabled || !text.trim()}
          onClick={onPaste}
        >
          Save pasted material
        </Button>
      </div>
      <StudyMaterialsPanelImport
        disabled={disabled}
        importing={importing}
        fileInput={fileInput}
        ocrScans={ocrScans}
        onOcrScansChange={onOcrScansChange}
        ocrProgress={ocrProgress}
        onFileSelected={onFileSelected}
        onCancel={onCancelImport}
      />
    </section>
  );
}
