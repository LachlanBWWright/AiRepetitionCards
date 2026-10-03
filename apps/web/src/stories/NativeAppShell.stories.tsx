import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Either, Schema } from "effect";
import { sha256 } from "@noble/hashes/sha2.js";
import { MediaReferenceSchema } from "@recall/domain";
import {
  applyWorkspaceAuthoringCommand,
  createPublishedMediaGateway,
  createPublishingApi,
  createTutorApi,
  toKnowledgeArea,
  type PublicationForkOperationStore,
} from "@recall/application";
import { NativeAppShell, type NativeAppTab } from "../../../mobile/src/components/NativeAppShell";
import { NativeTodayScreen } from "../../../mobile/src/components/NativeTodayScreen";
import {
  NativeWorkspaceAuthoringPanel,
  type NativeWorkspaceAuthoringPanelProps,
} from "../../../mobile/src/components/NativeWorkspaceAuthoringPanel";
import { NativeTutorPanel } from "../../../mobile/src/components/NativeTutorPanel";
import { NativePublishingPanel } from "../../../mobile/src/components/NativePublishingPanel";
import { NativeAccountPanel } from "../../../mobile/src/components/NativeAccountPanel";
import { mockWorkspace } from "../features/workspace/mock-data";

const now = new Date("2026-10-03T09:00:00.000Z");
const attachmentBytes = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);
const attachment = {
  reference: Schema.decodeUnknownSync(MediaReferenceSchema)({
    id: Array.from(sha256(attachmentBytes), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    mimeType: "image/png",
    byteLength: attachmentBytes.byteLength,
  }),
  bytes: attachmentBytes,
};
const mockResult = async () => "Mock action ready. No account or cloud service was contacted.";
const clients = {
  publishing: createPublishingApi(() => Effect.succeed({ status: 503, body: null })),
  media: createPublishedMediaGateway(() => Effect.succeed({ status: 503, body: null })),
};
const tutorApi = createTutorApi(() =>
  Effect.succeed({
    status: 503,
    body: { error: "Mock tutor is offline. Your draft remains available." },
  }),
);

function ShellStory({
  initialTab = "Today",
  initialEditor,
  localOnly = false,
}: {
  readonly initialTab?: NativeAppTab;
  readonly initialEditor?: NativeWorkspaceAuthoringPanelProps["initialEditor"];
  readonly localOnly?: boolean;
}) {
  const [workspace, setWorkspace] = useState(mockWorkspace);
  const [activeAreaId, setActiveAreaId] = useState<string>("area-biology");
  const [showAnswer, setShowAnswer] = useState(false);
  const operationStore = useMemo<PublicationForkOperationStore>(() => {
    const entries = new Map<string, string>();
    return {
      read: (key) => Effect.sync(() => entries.get(key) ?? null),
      write: (key, value) =>
        Effect.sync(() => {
          entries.set(key, value);
        }),
      clear: (key) =>
        Effect.sync(() => {
          entries.delete(key);
        }),
    };
  }, []);
  const selectedArea = workspace.areas.find((area) => area.id === activeAreaId);
  const exported = selectedArea
    ? Effect.runSync(Effect.either(toKnowledgeArea(selectedArea, true, true)))
    : null;
  const area = exported && Either.isRight(exported) ? exported.right : null;
  return (
    <div style={{ height: "100vh", display: "flex", background: "#faf9f6" }}>
      <NativeAppShell
        initialTab={initialTab}
        areas={workspace.areas}
        activeAreaId={activeAreaId}
        onSelectArea={(id) => {
          setActiveAreaId(id);
          setShowAnswer(false);
        }}
        today={
          <NativeTodayScreen
            ready
            workspace={workspace}
            activeAreaId={activeAreaId}
            now={now.getTime()}
            dateLabel="Sat, Oct 3"
            message={null}
            showAnswer={showAnswer}
            canReset={false}
            onSelectArea={setActiveAreaId}
            onHideAnswer={() => setShowAnswer(false)}
            onShowAnswer={() => setShowAnswer(true)}
            onReview={() => setShowAnswer(false)}
            onReset={() => undefined}
            onImportAnki={() => undefined}
          />
        }
        library={
          <NativeWorkspaceAuthoringPanel
            workspace={workspace}
            activeAreaId={activeAreaId}
            createId={() => "00000000-0000-4000-8000-000000000810"}
            onPickAttachment={() => Effect.succeed(attachment)}
            {...(initialEditor ? { initialEditor } : {})}
            onCommand={async (command, expectedBaseline) => {
              const result = Effect.runSync(
                Effect.either(
                  applyWorkspaceAuthoringCommand(workspace, command, now, expectedBaseline),
                ),
              );
              if (Either.isLeft(result)) return { ok: false, message: result.left.message };
              setWorkspace(result.right.workspace);
              return { ok: true, message: result.right.message };
            }}
          />
        }
        tutor={
          <NativeTutorPanel
            area={area}
            api={localOnly ? null : tutorApi}
            createId={() => "00000000-0000-4000-8000-000000000811"}
            initialSessionId={null}
            onSessionIdChange={() => undefined}
            onApproveProposal={async () => null}
          />
        }
        sharing={
          <NativePublishingPanel
            area={area}
            mediaStore={null}
            {...(localOnly ? {} : { clients })}
            forkOperationStore={operationStore}
            publicationOperationStore={operationStore}
            createForkOperationId={() => "00000000-0000-4000-8000-000000000812"}
            createPublishShareToken={() => "A".repeat(43)}
            onFork={async () => true}
          />
        }
        account={
          <NativeAccountPanel
            cloudAvailable={!localOnly}
            account={localOnly ? null : "learner@example.com"}
            conflictAreas={null}
            onSync={mockResult}
            onUseServerVersion={mockResult}
            onImport={mockResult}
            onExport={mockResult}
            onImportDelimited={mockResult}
            onExportDelimited={mockResult}
            onBackupRestore={mockResult}
            onBackupExport={mockResult}
            onExportAccount={mockResult}
            onDeleteAccount={mockResult}
            onSignOut={mockResult}
            onRequestSignIn={mockResult}
          />
        }
      />
    </div>
  );
}

const meta = {
  title: "Screens/Native App Shell",
  component: ShellStory,
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
} satisfies Meta<typeof ShellStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Today: Story = { name: "Navigation · Today (native)", args: { initialTab: "Today" } };
export const Library: Story = {
  name: "Navigation · Library (native)",
  args: { initialTab: "Library" },
};
export const CardAttachments: Story = {
  name: "Navigation · Card attachments (native)",
  args: { initialTab: "Library", initialEditor: "edit-card" },
};
export const Tutor: Story = { name: "Navigation · Tutor (native)", args: { initialTab: "Tutor" } };
export const Sharing: Story = {
  name: "Navigation · Sharing (native)",
  args: { initialTab: "Sharing" },
};
export const Account: Story = {
  name: "Navigation · Account (native)",
  args: { initialTab: "Account" },
};
export const LocalAccount: Story = {
  name: "Navigation · Local account (native)",
  args: { initialTab: "Account", localOnly: true },
};
export const LocalTutor: Story = {
  name: "Navigation · Local tutor unavailable (native)",
  args: { initialTab: "Tutor", localOnly: true },
};
export const LocalSharing: Story = {
  name: "Navigation · Local sharing (native)",
  args: { initialTab: "Sharing", localOnly: true },
};
