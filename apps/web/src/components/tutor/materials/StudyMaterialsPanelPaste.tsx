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
    <section className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="grid gap-6 pt-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-8">
        <div className="min-w-0 space-y-5">
          <Label>
            Material name
            <Input
              disabled={disabled}
              value={name}
              maxLength={200}
              placeholder="e.g. Biology lecture notes"
              onChange={(event) => {
                onNameChange(event.target.value);
              }}
            />
          </Label>
          <Label>
            Paste study text
            <Textarea
              disabled={disabled}
              value={text}
              className="min-h-48 resize-y leading-6"
              maxLength={500000}
              onChange={(event) => {
                onTextChange(event.target.value);
              }}
              placeholder="Paste lecture notes, a chapter, or code examples…"
            />
          </Label>
          <Button
            type="button"
            variant="primary"
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
      </div>
    </section>
  );
}
