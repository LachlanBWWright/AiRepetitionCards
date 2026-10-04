# Published card media

Knowledge Area publication media uses the existing content-addressed `MediaReference` format. The application port is `PublishedMediaGateway`; each platform supplies its own transport to the shared `createPublishedMediaGateway` implementation. That implementation validates references and upload responses, and verifies downloaded MIME signatures, lengths, and SHA-256 hashes. The web adapter uploads locally stored bytes before creating a publication and downloads referenced files before saving a fork. Electron keeps credentials in the main process and exposes only bounded, sender-validated binary IPC. Mobile injects its secure-session bearer-token provider into the native transport.

## Web API

- `POST /api/v1/publishing/media/{sha256}` accepts raw bytes and an `x-recall-media-reference` JSON header. It requires an authenticated owner session, limits files to 20 MB, checks the declared size and MIME type against the bytes, and stores them in the private `published-media` bucket at `{ownerId}/{sha256}`.
- `POST /api/v1/knowledge-areas` verifies every referenced object belongs to the publisher and matches its content hash before saving the immutable snapshot. A publication can reference at most 128 unique assets and 40 MB total.
- `GET /api/v1/published/{versionId}/media/{sha256}` checks that the snapshot references the asset and that it is public, or that the request has the valid unlisted share token. It streams verified bytes with a MIME type from the validated reference and `nosniff` headers.

Apply `supabase/migrations/20261003103000_published_media_storage.sql` after the publication schema migration. The bucket remains private; storage row policies allow owners to upload and read their own assets, and allow shared reads only through a publication reference. Unlisted access passes a token hash from the server after the database token check. No service-role key is sent to a client or needed by these routes.

The gateway returns typed failures for unavailable storage and invalid content. Missing or corrupt media prevents publication or fork import rather than creating a copy with broken attachments. Orphaned uploads can remain after a user abandons a publish attempt; a later cleanup job can remove unreferenced objects without affecting snapshots.
