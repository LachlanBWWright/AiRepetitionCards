"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { deckSharingApi } from "@/lib/deck-sharing-api";
import { DeckSharingPanel } from "./DeckSharingPanel";
import { DeckVersionPreview } from "../updates/DeckVersionPreview";

type PreviewRequest = { readonly versionId: string; readonly token?: string };

export function DeckLandingClient({
  deckId,
  token,
}: {
  readonly deckId?: string;
  readonly token?: string;
}) {
  const router = useRouter();
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const previewToken = previewRequest?.token;
  return (
    <div className="space-y-6">
      <DeckSharingPanel
        api={deckSharingApi}
        {...(deckId ? { initialDeckId: deckId } : {})}
        {...(token ? { initialToken: token } : {})}
        onReviewVersion={(versionId, shareToken) => {
          setPreviewRequest({ versionId, ...(shareToken ? { token: shareToken } : {}) });
        }}
        onOpenDeck={(id, shareToken) => {
          const query = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
          router.push(`/decks/${encodeURIComponent(id)}${query}` as Route);
        }}
      />
      {previewRequest ? (
        <DeckVersionPreview
          key={`${previewRequest.versionId}:${previewToken ?? "public"}`}
          versionId={previewRequest.versionId}
          {...(previewToken ? { token: previewToken } : {})}
          onAddPersonalCopy={() => {
            const query = previewToken ? `?token=${encodeURIComponent(previewToken)}` : "";
            router.push(`/shared/${encodeURIComponent(previewRequest.versionId)}${query}` as Route);
          }}
        />
      ) : null}
    </div>
  );
}
