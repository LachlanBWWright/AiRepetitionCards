import { useRef, type ComponentProps } from "react";
import type { MediaReference } from "@recall/domain";
import { Textarea } from "@recall/ui-web/components/textarea";
import { RichFormattingToolbar } from "./RichFormattingToolbar";

type Props = Omit<ComponentProps<typeof Textarea>, "onChange"> & {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly media?: readonly MediaReference[];
  readonly showPreview?: boolean;
};
export function RichTextEditor({
  value,
  onChange,
  media = [],
  showPreview = true,
  ...props
}: Props) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <Textarea
        {...props}
        ref={editorRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <RichFormattingToolbar
        value={value}
        onChange={onChange}
        media={media}
        showPreview={showPreview}
        disabled={props.disabled ?? false}
        editorRef={editorRef}
      />
    </>
  );
}
