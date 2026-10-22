import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import type { OcclusionMask } from "@recall/domain";
import { Button } from "@/components/ui/Button";
import { Input } from "@recall/ui-web/components/input";

export function OcclusionMaskFields({
  mask,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  readonly mask: OcclusionMask;
  readonly index: number;
  readonly canRemove: boolean;
  readonly onChange: (mask: OcclusionMask) => void;
  readonly onRemove: () => void;
}) {
  return (
    <fieldset className="grid gap-3 rounded-xl border border-border p-4">
      <legend className="px-1 text-sm font-medium">
        Mask {index + 1}: {mask.shape}
      </legend>
      <Input
        aria-label={`Mask ${String(index + 1)} label`}
        placeholder="Answer label (optional)"
        value={mask.label}
        onChange={(event) => {
          onChange({ ...mask, label: event.target.value });
        }}
      />
      <Input
        aria-label={`Mask ${String(index + 1)} group`}
        placeholder="Group name (optional)"
        value={mask.groupId ?? ""}
        onChange={(event) => {
          onChange({ ...mask, groupId: event.target.value || undefined });
        }}
      />
      <Accordion type="single" collapsible>
        <AccordionItem value="coordinates" className="border-0">
          <AccordionTrigger className="py-2 text-xs text-muted-foreground">
            Precise position
          </AccordionTrigger>
          <AccordionContent>
            <MaskCoordinates mask={mask} onChange={onChange} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {mask.shape === "polygon" && mask.points.length < 32 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onChange({ ...mask, points: [...mask.points, { x: 0.1, y: 0.5 }] });
          }}
        >
          Add polygon vertex
        </Button>
      )}
      {mask.shape === "polygon" && mask.points.length > 3 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onChange({ ...mask, points: mask.points.slice(0, -1) });
          }}
        >
          Remove last vertex
        </Button>
      )}
      <Button type="button" variant="secondary" disabled={!canRemove} onClick={onRemove}>
        Remove mask
      </Button>
    </fieldset>
  );
}
function CoordinateField({
  mask,
  pointIndex,
  axis,
  value,
  onChange,
}: {
  readonly mask: OcclusionMask;
  readonly pointIndex: number;
  readonly axis: "x" | "y";
  readonly value: number;
  readonly onChange: (mask: OcclusionMask) => void;
}) {
  return (
    <label>
      Point {pointIndex + 1} {axis}
      <Input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => {
          const number = Number(event.target.value);
          if (Number.isFinite(number))
            onChange({
              ...mask,
              points: mask.points.map((point, index) =>
                index === pointIndex ? { ...point, [axis]: number } : point,
              ),
            });
        }}
      />
    </label>
  );
}

function MaskCoordinates({
  mask,
  onChange,
}: {
  readonly mask: OcclusionMask;
  readonly onChange: (mask: OcclusionMask) => void;
}) {
  return (
    <div className="grid gap-2">
      {" "}
      {mask.points.map((point, pointIndex) => (
        <div className="flex gap-2" key={pointIndex}>
          {(["x", "y"] as const).map((axis) => (
            <CoordinateField
              key={axis}
              mask={mask}
              pointIndex={pointIndex}
              axis={axis}
              value={point[axis]}
              onChange={onChange}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
