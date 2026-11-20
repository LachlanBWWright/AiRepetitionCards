"use client";
import { useId } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web";
import { useBrowserAiFunding } from "./AiFundingProvider";

export function AiFundingSettings() {
  const funding = useBrowserAiFunding();
  const id = useId();
  if (!funding) return null;
  const status = funding.status;
  return (
    <section className="space-y-3 border-b pb-6">
      <h3 className="font-semibold">AI access</h3>
      <label htmlFor={id} className="block text-sm">
        Who provides your AI access?
      </label>
      <Select
        value={funding.mode}
        onValueChange={(mode) => {
          if (mode === "byo" || mode === "managed") funding.select(mode);
        }}
        disabled={!funding.owner}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="byo">My ChatGPT connection</SelectItem>
          <SelectItem value="managed">Recall managed AI</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        Your connection uses your ChatGPT allowance. Managed AI uses your Recall allowance and sends
        selected study content to Recall’s configured AI provider. Failed requests never switch
        funding.
      </p>
      {status?.available && (
        <p className="text-sm">
          Today: {status.requestsUsed} of {status.requestLimit} managed requests used.
        </p>
      )}
      {funding.unavailableReason && (
        <p className="text-sm text-muted-foreground" role="status">
          {funding.unavailableReason}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={funding.refresh}
        disabled={!funding.owner || funding.checking}
      >
        Refresh managed allowance
      </Button>
    </section>
  );
}
