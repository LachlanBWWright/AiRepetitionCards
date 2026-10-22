import type { MediaReference } from "@recall/domain";
import {
  formatRichSelection,
  insertRichText,
  type RichInsertion,
  type RichEdit,
} from "@recall/application";
import {
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Sigma,
  ImagePlus,
  Eye,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CardRichText } from "./CardRichText";
import { useState, type RefObject } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";

type Props = {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly media?: readonly MediaReference[];
  readonly showPreview?: boolean;
  readonly editorRef?: RefObject<HTMLTextAreaElement | null>;
};
const actions = [
  ["bold", "Bold", Bold],
  ["italic", "Italic", Italic],
  ["code", "Code", Code],
  ["bullet", "Bulleted list", List],
  ["number", "Numbered list", ListOrdered],
  ["math", "Equation", Sigma],
] as const satisfies readonly (readonly [RichInsertion, string, LucideIcon])[];
export function RichFormattingToolbar({
  value,
  onChange,
  disabled,
  media = [],
  showPreview = true,
  editorRef,
}: Props) {
  const [preview, setPreview] = useState(false);
  const images = media.filter((item) => item.mimeType.startsWith("image/"));
  const selection = () => ({
    start: editorRef?.current?.selectionStart ?? value.length,
    end: editorRef?.current?.selectionEnd ?? value.length,
  });
  const apply = (edit: RichEdit) => {
    if (
      editorRef?.current?.maxLength &&
      editorRef.current.maxLength > 0 &&
      edit.value.length > editorRef.current.maxLength
    )
      return;
    onChange(edit.value);
    requestAnimationFrame(() => {
      editorRef?.current?.focus();
      editorRef?.current?.setSelectionRange(edit.selection.start, edit.selection.end);
    });
  };
  return (
    <div className="grid gap-2">
      <div
        className="flex flex-wrap items-center gap-0.5 border-t border-border/60 px-2 py-1.5"
        role="group"
        aria-label="Card text formatting"
      >
        {actions.map(([kind, label, Icon]) => (
          <Button
            key={kind}
            type="button"
            size="icon"
            variant="ghost"
            className="size-9 text-muted-foreground"
            aria-label={label}
            title={label}
            disabled={disabled}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              apply(formatRichSelection(value, selection(), kind));
            }}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        ))}
        <ImageMenu
          images={images}
          disabled={disabled}
          onInsert={(id, index) => {
            apply(insertRichText(value, selection(), `![Image ${String(index + 1)}](media:${id})`));
          }}
        />
        {showPreview && (
          <Button
            type="button"
            size="small"
            variant="ghost"
            className="ml-auto gap-1.5 text-xs text-muted-foreground"
            aria-pressed={preview}
            onClick={() => {
              setPreview(!preview);
            }}
          >
            <Eye className="size-3.5" aria-hidden="true" /> {preview ? "Hide preview" : "Preview"}
          </Button>
        )}
      </div>
      {showPreview && preview && (
        <CardRichText
          text={value || "Your formatted text appears here."}
          className="px-4 pb-4 text-sm leading-relaxed"
        />
      )}
    </div>
  );
}

function ImageMenu({
  images,
  disabled,
  onInsert,
}: {
  readonly images: readonly MediaReference[];
  readonly disabled: boolean | undefined;
  readonly onInsert: (id: string, index: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 text-muted-foreground"
          aria-label="Insert attached image"
          title={images.length ? "Insert attached image" : "Attach an image to insert it"}
          disabled={disabled || !images.length}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {images.map((item, index) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => {
              onInsert(item.id, index);
            }}
          >
            Image {index + 1}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
