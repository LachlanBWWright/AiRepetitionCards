import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@recall/ui-web";
import { Checkbox } from "@recall/ui-web/components/checkbox";

type Difficulty = "" | "beginner" | "intermediate" | "advanced";
type Props = {
  readonly difficulty: Difficulty;
  readonly onDifficultyChange: (value: Difficulty) => void;
  readonly license: string;
  readonly onLicenseChange: (value: string) => void;
  readonly needsReuseConfirmation: boolean;
  readonly reuseConfirmed: boolean;
  readonly onReuseConfirmedChange: (value: boolean) => void;
};

export function KnowledgeAreaPublishingLicenseFields(props: Props) {
  return (
    <>
      <label>
        Difficulty (optional)
        <Select
          value={props.difficulty || "unspecified"}
          onValueChange={(value) => {
            if (value === "unspecified") props.onDifficultyChange("");
            else if (value === "beginner" || value === "intermediate" || value === "advanced")
              props.onDifficultyChange(value);
          }}
        >
          <SelectTrigger aria-label="Difficulty">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unspecified">Unspecified</SelectItem>
            <SelectItem value="beginner">Beginner</SelectItem>
            <SelectItem value="intermediate">Intermediate</SelectItem>
            <SelectItem value="advanced">Advanced</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>
        License
        <Select value={props.license || "none"} onValueChange={props.onLicenseChange}>
          <SelectTrigger aria-label="License">
            <SelectValue placeholder="Choose a license" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Choose a license</SelectItem>
            {props.license &&
              !["CC BY 4.0", "CC BY-SA 4.0", "CC0 1.0", "All rights reserved"].includes(
                props.license,
              ) && <SelectItem value={props.license}>{props.license}</SelectItem>}
            <SelectItem value="CC BY 4.0">CC BY 4.0</SelectItem>
            <SelectItem value="CC BY-SA 4.0">CC BY-SA 4.0</SelectItem>
            <SelectItem value="CC0 1.0">CC0 1.0</SelectItem>
            <SelectItem value="All rights reserved">All rights reserved</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {props.needsReuseConfirmation && (
        <label htmlFor="publication-reuse-confirmed">
          <Checkbox
            id="publication-reuse-confirmed"
            checked={props.reuseConfirmed}
            onCheckedChange={(checked) => {
              props.onReuseConfirmedChange(checked === true);
            }}
          />{" "}
          I own this content or have permission to share it under the selected license.
        </label>
      )}
    </>
  );
}
