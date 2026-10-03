"use client";

import { useState } from "react";
import { Effect, Either, Schema } from "effect";
import {
  ForkPublishedKnowledgeAreaResponseSchema,
  PublicationVisibilitySchema,
  PublishKnowledgeAreaResponseSchema,
  ReadPublishedKnowledgeAreaResponseSchema,
} from "@recall/contracts";
import type { KnowledgeArea } from "@recall/domain";

export type PublicationTransport = {
  readonly publish: (
    areaId: string,
    payload: {
      readonly content: KnowledgeArea;
      readonly visibility: "private" | "unlisted" | "public";
      readonly attribution: string | null;
      readonly license: string | null;
    },
  ) => Promise<unknown>;
  readonly receive: (versionId: string, token: string) => Promise<unknown>;
  readonly fork: (versionId: string, token: string) => Promise<unknown>;
};

const httpTransport: PublicationTransport = {
  publish: async (areaId, payload) => {
    const response = await fetch("/api/v1/knowledge-areas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceAreaId: areaId, ...payload }),
    });
    return response.json();
  },
  receive: async (versionId, token) => {
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const response = await fetch(`/api/v1/published/${encodeURIComponent(versionId)}${query}`);
    return response.json();
  },
  fork: async (versionId, token) => {
    const response = await fetch(`/api/v1/published/${encodeURIComponent(versionId)}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token ? { shareToken: token } : {}),
    });
    return response.json();
  },
};

type Props = {
  readonly area: KnowledgeArea;
  readonly onFork: (
    document: KnowledgeArea,
    attribution: string | null,
    license: string | null,
    forkedFromVersionId: string,
  ) => boolean;
  readonly transport?: PublicationTransport;
  readonly initialPublication?: {
    readonly versionId: string;
    readonly token: string;
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  };
};

export function KnowledgeAreaPublishing({
  area,
  onFork,
  transport = httpTransport,
  initialPublication,
}: Props) {
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("unlisted");
  const [attribution, setAttribution] = useState("");
  const [license, setLicense] = useState("CC BY 4.0");
  const [versionId, setVersionId] = useState(initialPublication?.versionId ?? "");
  const [token, setToken] = useState(initialPublication?.token ?? "");
  const [publication, setPublication] = useState<{
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null>(initialPublication ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasMedia = area.cards.some((card) => (card.media?.length ?? 0) > 0);
  const hasUnsupportedCardType = area.cards.some((card) => card.kind !== "basic");

  async function request(
    action: () => Promise<unknown>,
  ): Promise<Either.Either<unknown, { readonly _tag: "PublicationTransportFailure" }>> {
    return Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: action,
          catch: () => ({ _tag: "PublicationTransportFailure" }) as const,
        }),
      ),
    );
  }

  async function publish(): Promise<void> {
    if (hasUnsupportedCardType) {
      setNotice("Only Basic cards can be published at this time.");
      return;
    }
    if (hasMedia) {
      setNotice("This area has attachments. Shared media publishing is not available yet.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await request(() =>
      transport.publish(area.id, {
        content: area,
        visibility,
        attribution: attribution.trim() || null,
        license: license.trim() || null,
      }),
    );
    if (Either.isLeft(result)) {
      setNotice("Could not publish this Knowledge Area. Try again when connected.");
    } else {
      const decoded = Schema.decodeUnknownEither(PublishKnowledgeAreaResponseSchema)(result.right);
      if (Either.isLeft(decoded)) {
        setNotice("The publication service returned an invalid response.");
      } else {
        setVersionId(decoded.right.version.id);
        setToken(decoded.right.shareToken ?? "");
        setNotice("Knowledge Area published. Its study history remains private.");
      }
    }
    setBusy(false);
  }

  async function receive(): Promise<void> {
    if (!versionId.trim()) return;
    setBusy(true);
    setNotice(null);
    const result = await request(() => transport.receive(versionId.trim(), token.trim()));
    if (Either.isLeft(result)) {
      setPublication(null);
      setNotice("Could not load this shared Knowledge Area.");
    } else {
      const decoded = Schema.decodeUnknownEither(ReadPublishedKnowledgeAreaResponseSchema)(
        result.right,
      );
      if (Either.isLeft(decoded)) {
        setPublication(null);
        setNotice("This shared item could not be validated.");
      } else {
        const received = decoded.right.version;
        setVersionId(received.id);
        setPublication({
          document: received.content,
          attribution: received.attribution,
          license: received.license,
        });
        setNotice("Review the source and license before adding your own copy.");
      }
    }
    setBusy(false);
  }

  async function fork(): Promise<void> {
    if (!publication) return;
    setBusy(true);
    setNotice(null);
    const result = await request(() => transport.fork(versionId.trim(), token.trim()));
    if (Either.isLeft(result)) {
      setNotice("Could not create a personal copy of this Knowledge Area.");
    } else {
      const decoded = Schema.decodeUnknownEither(ForkPublishedKnowledgeAreaResponseSchema)(
        result.right,
      );
      if (Either.isLeft(decoded)) {
        setNotice("The fork response could not be validated.");
      } else {
        const copied = onFork(
          decoded.right.document,
          decoded.right.attribution,
          decoded.right.license,
          decoded.right.forkedFromVersionId,
        );
        setNotice(
          copied
            ? "A personal copy was added. Its review schedule starts fresh."
            : "This area contains content that this client cannot import yet.",
        );
      }
    }
    setBusy(false);
  }

  return (
    <section className="publication-panel" aria-labelledby="publication-title">
      <div className="publication-heading">
        <div>
          <p className="eyebrow">SHARE KNOWLEDGE</p>
          <h2 id="publication-title">Publish or receive an area</h2>
          <p>Shared content has no personal schedules or review history.</p>
          <p>Only attachment-free areas can be published until cloud media sharing is available.</p>
          <p>Cloze cards are not available in the current study-card model.</p>
        </div>
        <span className="publication-mark" aria-hidden="true">
          ↗
        </span>
      </div>
      <div className="publication-columns">
        <form
          className="publication-form"
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <h3>Publish “{area.title}”</h3>
          <label>
            Visibility
            <select
              value={visibility}
              onChange={(event) =>
                setVisibility(
                  Schema.decodeUnknownEither(PublicationVisibilitySchema)(
                    event.currentTarget.value,
                  ).pipe(Either.getOrElse(() => "unlisted" as const)),
                )
              }
            >
              <option value="unlisted">Unlisted · link access</option>
              <option value="private">Private · account only</option>
              <option value="public">Public · discoverable</option>
            </select>
          </label>
          <label>
            Attribution
            <input
              value={attribution}
              onChange={(event) => setAttribution(event.currentTarget.value)}
              placeholder="Your name or source"
              maxLength={200}
            />
          </label>
          <label>
            License
            <select value={license} onChange={(event) => setLicense(event.currentTarget.value)}>
              <option>CC BY 4.0</option>
              <option>CC BY-SA 4.0</option>
              <option>CC0 1.0</option>
              <option>All rights reserved</option>
            </select>
          </label>
          <button
            className="primary-action"
            type="submit"
            disabled={busy || hasMedia || hasUnsupportedCardType}
          >
            Publish area
          </button>
          {versionId && (
            <p className="publication-version">
              Version <code>{versionId}</code>
              {token && (
                <>
                  {" "}
                  · Link token <code>{token}</code>
                </>
              )}
            </p>
          )}
        </form>
        <div className="publication-form">
          <h3>Receive a shared area</h3>
          <label>
            Version ID
            <input
              value={versionId}
              onChange={(event) => setVersionId(event.currentTarget.value)}
              placeholder="Paste a shared version ID"
            />
          </label>
          <label>
            Access token <span className="optional-label">if required</span>
            <input
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
              placeholder="Paste link token"
            />
          </label>
          <button
            className="text-button"
            type="button"
            disabled={busy || !versionId.trim()}
            onClick={() => void receive()}
          >
            Preview shared area
          </button>
          {publication && (
            <div className="publication-review">
              <p className="eyebrow">SOURCE AND LICENSE</p>
              <h4>{publication.document.title}</h4>
              <p>{publication.document.description || "No description provided."}</p>
              <dl>
                <div>
                  <dt>Attribution</dt>
                  <dd>{publication.attribution || "Not provided"}</dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd>{publication.license || "Not provided"}</dd>
                </div>
                <div>
                  <dt>Cards</dt>
                  <dd>{publication.document.cards.length}</dd>
                </div>
              </dl>
              <button
                className="primary-action"
                type="button"
                disabled={busy}
                onClick={() => void fork()}
              >
                Add a personal copy
              </button>
            </div>
          )}
        </div>
      </div>
      {notice && (
        <p className="publication-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
