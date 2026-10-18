import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Progress } from "@recall/ui-web/components/progress";
import { Button, Input } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Upload } from "lucide-react";
import type { RefObject } from "react";
import type { StudyOcrProgress } from "@/lib/study-material-ocr";

type StudyMaterialsPanelImportProps = {
  readonly disabled: boolean;
  readonly importing: boolean;
  readonly fileInput: RefObject<HTMLInputElement | null>;
  readonly ocrScans: boolean;
  readonly onOcrScansChange: (enabled: boolean) => void;
  readonly ocrProgress: StudyOcrProgress | null;
  readonly onFileSelected: (file: File) => void;
  readonly onCancel: () => void;
};

export function StudyMaterialsPanelImport({
  disabled,
  importing,
  fileInput,
  ocrScans,
  onOcrScansChange,
  ocrProgress,
  onFileSelected,
  onCancel,
}: StudyMaterialsPanelImportProps) {
  return (
    <aside className="space-y-4 border-t pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Import a file</h4>
        <p className="text-sm leading-6 text-muted-foreground">
          Add a document or an image of your notes. Text is extracted on this device.
        </p>
      </div>
      <Input
        ref={fileInput}
        className="hidden"
        aria-label="Import documents or images"
        type="file"
        accept=".txt,.md,.markdown,.docx,.pdf,.png,.jpg,.jpeg,.webp"
        disabled={disabled || importing}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFileSelected(file);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || importing}
        onClick={() => fileInput.current?.click()}
      >
        <Upload aria-hidden="true" />
        Choose a file
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">
        TXT, Markdown, Word, PDF, PNG, JPEG and WebP.
      </p>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold leading-6">Scanned PDFs and import help</h3>
        <div className="space-y-4 pt-3">
          <Label>
            <Checkbox
              checked={ocrScans}
              disabled={disabled || importing}
              onCheckedChange={(checked) => {
                onOcrScansChange(checked === true);
              }}
            />
            Read scanned PDF pages (up to 30)
          </Label>
          <p>
            Supports TXT, Markdown, DOCX, PDF, PNG, JPEG and WebP. Scanned text recognition is
            English only. Check spelling, tables, formulas and code after import. Files are read on
            this device.
          </p>
        </div>
      </section>
      {importing && (
        <>
          <Alert role="status">
            <AlertDescription>
              {ocrProgress
                ? `Reading page ${String(ocrProgress.page)} of ${String(ocrProgress.pages)} · ${String(Math.round(ocrProgress.progress * 100))}%`
                : "Extracting document text locally…"}
            </AlertDescription>
          </Alert>
          {ocrProgress && (
            <Progress
              value={Math.max(0, Math.min(100, Math.round(ocrProgress.progress * 100)))}
              aria-label={`Reading page ${String(ocrProgress.page)} of ${String(ocrProgress.pages)}`}
            />
          )}
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel import
          </Button>
        </>
      )}
    </aside>
  );
}
