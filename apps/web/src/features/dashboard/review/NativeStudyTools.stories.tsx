import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect, Either } from "effect";
import type { Workspace } from "@recall/domain";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import { NativeAdditionalStudyTools } from "../../../../../mobile/src/components/review/NativeAdditionalStudyTools";
import { NativeCramPractice } from "../../../../../mobile/src/components/review/NativeCramPractice";
import { mockWorkspace } from "@/features/workspace/mock-data";
function NativeStudyToolsStory() {
  const [workspace, setWorkspace] = useState<Workspace>(mockWorkspace);
  const area = workspace.areas[0];
  if (!area) return null;
  const save: import("@recall/react").StudyCommandPromiseSave = async (command, baseline) => {
    const result = await Effect.runPromise(
      Effect.either(
        applyWorkspaceAuthoringCommand(
          workspace,
          command,
          new Date("2026-10-19T12:00:00.000Z"),
          baseline,
        ),
      ),
    );
    if (Either.isLeft(result)) return { ok: false, message: result.left.message };
    setWorkspace(result.right.workspace);
    return { ok: true, message: result.right.message };
  };
  return (
    <main className="mx-auto max-w-2xl p-6">
      <NativeAdditionalStudyTools
        workspace={workspace}
        area={area}
        now={Date.parse("2026-10-19T12:00:00.000Z")}
        save={save}
        disabled={false}
      />
      <NativeCramPractice
        workspace={workspace}
        area={area}
        mediaStore={null}
        mediaRevision={0}
        onExit={() => undefined}
        save={save}
      />
      <p>
        Review events: {workspace.reviewEvents?.length ?? 0} · corrections:{" "}
        {workspace.reviewCorrections?.length ?? 0}
      </p>
    </main>
  );
}
const meta = {
  title: "Knowledge/Native study tools",
  component: NativeStudyToolsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NativeStudyToolsStory>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
