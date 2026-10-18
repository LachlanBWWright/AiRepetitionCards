import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@recall/ui-web";
type Props = {
  readonly visibility: "unlisted" | "public";
  readonly onVisibilityChange: (value: "unlisted" | "public") => void;
  readonly releaseNotes: string;
  readonly onReleaseNotesChange: (value: string) => void;
  readonly attribution: string;
  readonly onAttributionChange: (value: string) => void;
};

export function KnowledgeAreaPublishingMetadataFields(props: Props) {
  return (
    <>
      <label>
        Visibility
        <Select
          value={props.visibility}
          onValueChange={(value) => {
            props.onVisibilityChange(value === "public" ? "public" : "unlisted");
          }}
        >
          <SelectTrigger aria-label="Visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unlisted">Unlisted · link access</SelectItem>
            <SelectItem value="public">Public access</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>
        Release notes (optional)
        <Textarea
          value={props.releaseNotes}
          onChange={(event) => {
            props.onReleaseNotesChange(event.currentTarget.value);
          }}
          maxLength={4000}
          placeholder="Describe what changed in this release"
        />
      </label>
      <label>
        Attribution
        <Input
          value={props.attribution}
          onChange={(event) => {
            props.onAttributionChange(event.currentTarget.value);
          }}
          placeholder="Your name or source"
          maxLength={200}
        />
      </label>
    </>
  );
}
