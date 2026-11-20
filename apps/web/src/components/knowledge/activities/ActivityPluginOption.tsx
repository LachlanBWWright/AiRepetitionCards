import { inspectActivityPluginCompatibility, type ActivityRegistry } from "@recall/application";
import { Label, RadioGroupItem } from "@recall/ui-web";

export function ActivityPluginOption({
  plugin,
  platform,
}: {
  readonly plugin: ActivityRegistry[number];
  readonly platform: "web" | "native";
}) {
  const compatibility = inspectActivityPluginCompatibility(
    plugin,
    platform,
    plugin.capabilities.assessment,
  );
  return (
    <Label className="flex items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[:disabled]:opacity-50">
      <RadioGroupItem value={plugin.id} className="mt-0.5 shrink-0" />
      <span className="grid gap-1">
        <span className="block font-medium">
          {plugin.label} · v{plugin.version}
        </span>
        <span className="block text-sm text-muted-foreground">
          {compatibility.platform} · {plugin.capabilities.assessment} assessment ·{" "}
          {plugin.capabilities.offline ? "offline" : "online"}
          {plugin.capabilities.execution ? " · code execution capability" : ""}
        </span>
      </span>
    </Label>
  );
}
