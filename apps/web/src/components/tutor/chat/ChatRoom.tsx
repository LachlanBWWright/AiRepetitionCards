import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { ChatModelPicker, type ChatModelSelection } from "./ChatModelPicker";
import { ChatContextMeter } from "./ChatContextMeter";
import { ChatMessageContent } from "./ChatMessageContent";
export type ChatMessage = {
  readonly id: string;
  readonly role: "learner" | "assistant";
  readonly content: string;
};
export type ChatRoomProps = {
  readonly label: string;
  readonly inputId: string;
  readonly greeting: string;
  readonly placeholder: string;
  readonly messages: readonly ChatMessage[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly maxLength: number;
  readonly afterMessages?: ReactNode;
  readonly pendingMessage?: string | undefined;
  readonly modelSelection?: ChatModelSelection | undefined;
};
export function ChatRoom(props: ChatRoomProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 192)}px`;
  }, [props.value]);
  useEffect(() => {
    const element = scroll.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [props.messages.length, props.busy, props.afterMessages]);
  const empty = props.messages.length === 0 && !props.pendingMessage;
  function send() {
    if (!props.disabled && !props.busy && props.value.trim()) {
      follow.current = true;
      props.onSend();
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={props.label}>
      <div
        ref={scroll}
        onScroll={() => {
          const element = scroll.current;
          if (element)
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        role="log"
        aria-label={`${props.label} messages`}
        aria-live="polite"
        aria-busy={props.busy}
      >
        <div
          className={`mx-auto flex min-h-full w-full max-w-[800px] flex-col gap-7 px-5 py-8 sm:px-8 ${empty ? "justify-center" : ""}`}
        >
          {empty && (
            <h2 className="text-center text-2xl font-medium tracking-tight text-foreground">
              {props.greeting}
            </h2>
          )}
          {props.messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} />
          ))}
          {props.pendingMessage && (
            <ChatMessageBubble
              message={{ id: "pending", role: "learner", content: props.pendingMessage }}
            />
          )}
          {props.busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Thinking…
            </p>
          )}
          {props.afterMessages}
        </div>
      </div>
      <form
        className="mx-auto w-full max-w-[800px] shrink-0 px-4 pb-4 pt-2 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="rounded-2xl border border-input bg-card p-2 shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <Label className="sr-only" htmlFor={props.inputId}>
            {props.label} message
          </Label>
          <Textarea
            ref={textarea}
            id={props.inputId}
            aria-label={`${props.label} message`}
            rows={1}
            className="max-h-48 min-h-12 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 py-3 text-[15px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder={props.placeholder}
            value={props.value}
            maxLength={props.maxLength}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="mt-1 flex items-center gap-1 px-1">
            <ChatModelPicker selection={props.modelSelection} busy={props.busy} />
            <div className="ml-auto flex items-center gap-2">
              <ChatContextMeter usage={props.modelSelection?.usage} />
              <Button
                type="submit"
                size="icon"
                className="size-8 shrink-0 rounded-full"
                aria-label="Send message"
                disabled={props.disabled || props.busy || !props.value.trim()}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
function ChatMessageBubble({ message }: { readonly message: ChatMessage }) {
  return (
    <div
      className={`min-w-0 text-[15px] leading-7 [overflow-wrap:anywhere] ${message.role === "learner" ? "ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2.5" : "w-full"}`}
    >
      <span className="sr-only">{message.role === "learner" ? "You" : "Tutor"}: </span>
      {message.role === "assistant" ? (
        <ChatMessageContent content={message.content} />
      ) : (
        message.content
      )}
    </div>
  );
}
