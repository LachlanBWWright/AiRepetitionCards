import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@recall/ui-web/components/collapsible";
import { useEquationEditor } from "@recall/react";
import { cardEquationError } from "@recall/infra-rich-content";
import { EquationEditor } from "./equations/EquationEditor";
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
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@recall/ui-web/components/tooltip";
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
] as const satisfies readonly (readonly [RichInsertion, string, LucideIcon])[];
export function RichFormattingToolbar({
  value,
  onChange,
  disabled,
  media = [],
  showPreview = true,
  editorRef,
}: Props) {
  const equation = useEquationEditor(cardEquationError);
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
        className="flex flex-wrap items-center gap-2 border-t border-border/60 px-2 py-1.5"
        role="group"
        aria-label="Card text formatting"
      >
        <FormattingActions
          disabled={disabled}
          onApply={(kind) => {
            apply(formatRichSelection(value, selection(), kind));
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label="Equation"
              disabled={disabled}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                equation.open(value, selection(), editorRef?.current?.maxLength);
              }}
            >
              <Sigma className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Equation</TooltipContent>
        </Tooltip>
        <ImageMenu
          images={images}
          disabled={disabled}
          onInsert={(id, index) => {
            apply(insertRichText(value, selection(), `![Image ${String(index + 1)}](media:${id})`));
          }}
        />
      </div>
      <EquationEditor
        editor={equation}
        onInsert={() => {
          const edit = equation.edit();
          if (!edit) return;
          if (
            editorRef?.current &&
            editorRef.current.maxLength > 0 &&
            edit.value.length > editorRef.current.maxLength
          )
            return;
          equation.close();
          apply(edit);
        }}
      />
      {showPreview && (
        <Collapsible open={preview} onOpenChange={setPreview}>
          <CollapsibleTrigger>Formatted preview</CollapsibleTrigger>
          <CollapsibleContent>
            <CardRichText
              text={value || "Your formatted text appears here."}
              className="px-4 pb-4 text-sm leading-relaxed"
            />
          </CollapsibleContent>
        </Collapsible>
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
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label="Insert attached image"
              disabled={disabled || !images.length}
            >
              <ImagePlus className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {images.length ? "Insert attached image" : "Attach an image to insert it"}
        </TooltipContent>
      </Tooltip>
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

function FormattingActions({
  disabled,
  onApply,
}: {
  readonly disabled: boolean | undefined;
  readonly onApply: (kind: RichInsertion) => void;
}) {
  return (
    <>
      {actions.map(([kind, label, Icon]) => (
        <Tooltip key={kind}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              aria-label={label}
              disabled={disabled}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                onApply(kind);
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </>
  );
}
