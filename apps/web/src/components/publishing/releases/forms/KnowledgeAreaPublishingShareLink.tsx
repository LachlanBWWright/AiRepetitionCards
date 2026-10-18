import { Button } from "@/components/ui/Button";

type Props = {
  readonly embedded: boolean;
  readonly url: string | null;
  readonly path: string | null;
  readonly origin: string | null;
  readonly visibility: "private" | "unlisted" | "public";
  readonly onCopy: () => void;
};

export function KnowledgeAreaPublishingShareLink({
  embedded,
  url,
  path,
  origin,
  visibility,
  onCopy,
}: Props) {
  return (
    <>
      {url && (
        <div
          className={
            embedded ? "grid gap-2 border-t pt-4" : "grid gap-2 rounded-xl border bg-muted/40 p-4"
          }
        >
          <p>{visibility === "public" ? "Public access" : "Share link"}</p>
          <a
            className="[overflow-wrap:anywhere] text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            href={url}
          >
            {url}
          </a>
          <Button type="button" onClick={onCopy}>
            Copy link
          </Button>
        </div>
      )}
      {path && !origin && <p>Configure the web server URL to create a share link.</p>}
    </>
  );
}
