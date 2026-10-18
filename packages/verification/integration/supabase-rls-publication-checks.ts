import { createHash } from "node:crypto";
import { Effect } from "effect";
import {
  denied,
  request,
  rows,
  successful,
  verify,
  type Configuration,
  type Identity,
  type IntegrationFailure,
  type Reply,
} from "./supabase-http";

export type PublicationChecksOptions = {
  readonly config: Configuration;
  readonly admin: Identity;
  readonly anon: Identity;
  readonly owner: Identity & { readonly userId: string };
  readonly stranger: Identity & { readonly userId: string };
  readonly areaId: string;
  readonly mediaBytes: Uint8Array;
  readonly otherBytes: Uint8Array;
  readonly mediaId: string;
  readonly otherMediaId: string;
  readonly document: unknown;
  readonly contentHash: string;
  readonly id: () => string;
  readonly uploadedPaths: Set<string>;
  readonly publications: string[];
  readonly rpc: (
    identity: Identity,
    name: string,
    body: unknown,
  ) => Effect.Effect<Reply, IntegrationFailure>;
  readonly expectDenied: (
    effect: Effect.Effect<Reply, IntegrationFailure>,
    label: string,
  ) => Effect.Effect<void, IntegrationFailure>;
};

export function runPublicationChecks(options: PublicationChecksOptions) {
  const {
    config,
    admin,
    anon,
    owner,
    stranger,
    areaId,
    mediaBytes,
    otherBytes,
    mediaId,
    otherMediaId,
    document,
    contentHash,
    id,
    uploadedPaths,
    publications,
    rpc,
    expectDenied,
  } = options;
  return Effect.gen(function* () {
    const uploadPath = `${owner.userId}/${mediaId}`;
    uploadedPaths.add(uploadPath);
    yield* successful(
      yield* request(config, owner, `/storage/v1/object/published-media/${uploadPath}`, {
        method: "POST",
        bytes: mediaBytes,
        headers: { "content-type": "image/png", "x-upsert": "false" },
      }),
      "Owner Storage upload",
    );
    const unreferencedPath = `${owner.userId}/${otherMediaId}`;
    uploadedPaths.add(unreferencedPath);
    yield* successful(
      yield* request(config, owner, `/storage/v1/object/published-media/${unreferencedPath}`, {
        method: "POST",
        bytes: otherBytes,
        headers: { "content-type": "image/png" },
      }),
      "Owner unreferenced Storage upload",
    );
    const download = (identity: Identity, path: string, version?: string, hash?: string) =>
      request(config, identity, `/storage/v1/object/authenticated/published-media/${path}`, {
        headers: {
          ...(version ? { "x-recall-publication-version-id": version } : {}),
          ...(hash ? { "x-recall-share-token-hash": hash } : {}),
        },
      });
    const ownerMedia = yield* download(owner, uploadPath);
    yield* successful(ownerMedia, "Owner private Storage read");
    yield* verify(
      Buffer.from(ownerMedia.bytes).equals(Buffer.from(mediaBytes)),
      "Owner Storage bytes changed.",
    );
    for (const identity of [anon, stranger])
      yield* expectDenied(download(identity, uploadPath), "Unpublished Storage read");
    const strangerPath = `${stranger.userId}/${mediaId}`;
    uploadedPaths.add(strangerPath);
    yield* successful(
      yield* request(config, stranger, `/storage/v1/object/published-media/${strangerPath}`, {
        method: "POST",
        bytes: mediaBytes,
        headers: { "content-type": "image/png" },
      }),
      "Stranger can upload in own namespace",
    );
    yield* expectDenied(download(owner, strangerPath), "Owner cannot read stranger private media");
    const foreignBytes = new Uint8Array([...mediaBytes, 1]);
    const foreignHash = createHash("sha256").update(foreignBytes).digest("hex");
    const foreignPath = `${owner.userId}/${foreignHash}`;
    uploadedPaths.add(foreignPath);
    yield* expectDenied(
      request(config, stranger, `/storage/v1/object/published-media/${foreignPath}`, {
        method: "POST",
        bytes: foreignBytes,
        headers: { "content-type": "image/png" },
      }),
      "Stranger cannot upload in owner's namespace",
    );
    const tokenHash = createHash("sha256").update(id()).digest("hex");
    const wrongHash = createHash("sha256").update(id()).digest("hex");
    const versions = { missing: id(), unlisted: id(), public: id() };
    for (const visibility of ["unlisted", "public"] as const) {
      const publicationId = versions[visibility];
      publications.push(publicationId);
      const publicationArgs = {
        p_version_id: publicationId,
        p_source_area_id: areaId,
        p_owner_id: owner.userId,
        p_operation_id: id(),
        p_content: document,
        p_content_hash: contentHash,
        p_visibility: visibility,
        p_attribution: null,
        p_license: "CC-BY-4.0",
        p_forked_from_version_id: null,
        p_share_token_hash: visibility === "unlisted" ? tokenHash : null,
      };
      if (visibility === "unlisted") {
        const privatePublication = yield* rpc(admin, "create_deck_publication", {
          ...publicationArgs,
          p_version_id: versions.missing,
          p_visibility: "private",
          p_share_token_hash: null,
        });
        yield* verify(
          privatePublication.status === 400 &&
            typeof privatePublication.body === "object" &&
            privatePublication.body !== null &&
            "message" in privatePublication.body &&
            privatePublication.body.message === "invalid-publication-visibility",
          "Private content must remain unpublished; private visibility was not rejected.",
        );
      }
      yield* successful(
        yield* rpc(admin, "create_deck_publication", publicationArgs),
        "Service atomic immutable publication registration",
      );
      yield* expectDenied(
        rpc(owner, "create_deck_publication", {
          ...publicationArgs,
          p_version_id: id(),
          p_operation_id: id(),
        }),
        "Authenticated direct publication registration",
      );
      for (const identity of [owner, anon, stranger]) {
        const reply = yield* request(
          config,
          identity,
          `/rest/v1/published_knowledge_area_versions?select=id,content,visibility&id=eq.${publicationId}`,
        );
        if (identity === owner || visibility === "public")
          yield* verify(
            (yield* rows(reply, "Publication readable")).length === 1,
            "Readable publication was hidden.",
          );
        else yield* verify(denied(reply), "Private/unlisted publication leaked through SELECT.");
      }
      yield* expectDenied(
        request(
          config,
          owner,
          `/rest/v1/published_knowledge_area_versions?select=share_token_hash&id=eq.${publicationId}`,
        ),
        "Publication token digest SELECT",
      );
      yield* expectDenied(
        request(
          config,
          owner,
          `/rest/v1/published_knowledge_area_versions?id=eq.${publicationId}`,
          { method: "PATCH", body: { content: {} } },
        ),
        "Publication immutable content",
      );
    }
    for (const identity of [anon, stranger]) {
      yield* expectDenied(
        rpc(identity, "read_unlisted_knowledge_area_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: tokenHash,
        }),
        "Retired unlisted helper rejects direct client reads",
      );
      for (const [hash, expected] of [
        [wrongHash, 0],
        [tokenHash, 1],
      ] as const) {
        const result = yield* rpc(identity, "read_deck_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: hash,
        });
        yield* verify(
          (yield* rows(result, "Unlisted capability read")).length === expected,
          "Unlisted capability isolation failed.",
        );
      }
      yield* expectDenied(
        download(identity, uploadPath, versions.missing, tokenHash),
        "Missing publication cannot authorize Storage read",
      );
      yield* expectDenied(
        download(identity, uploadPath, versions.unlisted, wrongHash),
        "Wrong unlisted Storage capability",
      );
      yield* successful(
        yield* download(identity, uploadPath, versions.unlisted, tokenHash),
        "Valid unlisted Storage capability",
      );
      yield* successful(
        yield* download(identity, uploadPath, versions.public),
        "Public referenced Storage read",
      );
      yield* expectDenied(
        download(identity, unreferencedPath, versions.public),
        "Unreferenced Storage read",
      );
    }
    const forbiddenRotation = yield* rpc(stranger, "manage_unlisted_knowledge_area_share_token", {
      p_version_id: versions.unlisted,
      p_action: "revoke",
      p_share_token_hash: null,
    });
    yield* successful(forbiddenRotation, "Foreign token management rejection");
    yield* verify(
      forbiddenRotation.body === false,
      "Stranger revoked another owner's share capability.",
    );
    const rotated = yield* rpc(owner, "manage_unlisted_knowledge_area_share_token", {
      p_version_id: versions.unlisted,
      p_action: "rotate",
      p_share_token_hash: wrongHash,
    });
    yield* successful(rotated, "Owner token rotation");
    yield* verify(rotated.body === true, "Owner token rotation failed.");
    yield* verify(
      (yield* rows(
        yield* rpc(anon, "read_deck_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: tokenHash,
        }),
        "Old token revoked",
      )).length === 0,
      "Rotated token still reads content.",
    );
    yield* expectDenied(
      download(anon, uploadPath, versions.unlisted, tokenHash),
      "Rotated token still reads media",
    );
    const revoked = yield* rpc(owner, "manage_unlisted_knowledge_area_share_token", {
      p_version_id: versions.unlisted,
      p_action: "revoke",
      p_share_token_hash: null,
    });
    yield* successful(revoked, "Owner token revocation");
    yield* verify(revoked.body === true, "Owner token revocation failed.");
    yield* verify(
      (yield* rows(
        yield* rpc(anon, "read_deck_version", {
          p_version_id: versions.unlisted,
          p_share_token_hash: wrongHash,
        }),
        "Revoked capability read",
      )).length === 0,
      "Revoked token still reads content.",
    );
    yield* expectDenied(
      download(anon, uploadPath, versions.unlisted, wrongHash),
      "Revoked token still reads media",
    );
    return uploadPath;
  });
}
