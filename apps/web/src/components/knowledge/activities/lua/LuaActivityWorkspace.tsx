"use client";
import { Button } from "@recall/ui-web";
import { useLuaActivity, type LuaActivityWorkspaceProps } from "@recall/react";

export function LuaActivityWorkspace(props: LuaActivityWorkspaceProps) {
  const model = useLuaActivity(props);
  const locked = Boolean(props.disabled) || model.busy;
  return (
    <section className="grid gap-3 rounded-md border p-3" aria-label="Lua activity">
      {model.view ? (
        <>
          <p className="whitespace-pre-wrap">{model.view.text}</p>
          <LuaActions
            buttons={model.view.buttons}
            disabled={locked}
            onAction={(id) => {
              model.dispatch({ id });
            }}
          />
          <p className="text-sm text-muted-foreground">
            When finished, request assessment and review the proposal before accepting it.
          </p>
        </>
      ) : (
        <Button disabled={locked} onClick={model.start}>
          Open or resume Lua activity
        </Button>
      )}
      {model.message ? <p role="status">{model.message}</p> : null}
      <div className="rounded-md border p-3">
        <p className="font-medium">Fallback activity</p>
        <p className="whitespace-pre-wrap">{props.activity.fallback}</p>
        <p className="text-sm text-muted-foreground">
          If execution is unavailable, use this content for manual study. No script completion is
          recorded.
        </p>
      </div>
    </section>
  );
}

function LuaActions({
  buttons,
  disabled,
  onAction,
}: {
  readonly buttons: readonly { readonly id: string; readonly label: string }[];
  readonly disabled: boolean;
  readonly onAction: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((button) => (
        <Button
          key={button.id}
          disabled={disabled}
          onClick={() => {
            onAction(button.id);
          }}
        >
          {button.label}
        </Button>
      ))}
    </div>
  );
}
