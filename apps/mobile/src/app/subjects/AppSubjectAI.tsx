import { View } from "react-native";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import { toKnowledgeArea, workspaceDuplicateCandidates } from "@recall/application";
import { NativeKnowledgeNotebookPanel } from "../../components/tutor/notebook/NativeKnowledgeNotebookPanel";
import { AppSubjectTutor } from "./AppSubjectTutor";
import type { AppModel } from "../useAppController";
export function AppSubjectAI({ model }: { readonly model: AppModel }) {
  const ai =
    model.subjectMode === "tutor" ||
    model.subjectMode === "improve" ||
    (model.subjectMode === "overview" && model.subjectSection === "materials");
  return (
    <>
      {(model.workspace?.areas ?? [])
        .filter((area) => ai && area.id === model.activeAreaId)
        .map((area) => {
          const converted = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
          if (Either.isLeft(converted)) return null;
          const document = converted.right;
          const visible = ai && model.activeAreaId === area.id;
          const materials =
            model.subjectMode === "overview" && model.subjectSection === "materials";
          const namespace =
            model.chatGPT.tutorMode === "chatgpt"
              ? `knowledge-notebook:${model.tutorScope}`
              : "knowledge-notebook";
          return (
            <SubjectAI
              key={`${model.tutorScope}:${area.id}`}
              model={model}
              area={document}
              visible={visible}
              materials={materials}
              namespace={namespace}
            />
          );
        })}
    </>
  );
}

function SubjectAI({
  model,
  area,
  visible,
  materials,
  namespace,
}: {
  readonly model: AppModel;
  readonly area: import("@recall/domain").KnowledgeArea;
  readonly visible: boolean;
  readonly materials: boolean;
  readonly namespace: string;
}) {
  return (
    <View className={visible ? "min-h-0 flex-1" : "hidden"}>
      {model.subjectMode === "tutor" && (
        <View className="min-h-0 flex-1">
          <AppSubjectTutor area={area} model={model} />
        </View>
      )}
      {(model.subjectMode === "improve" || materials) && (
        <View className="min-h-0 flex-1">
          <NativeKnowledgeNotebookPanel
            key={materials ? "materials" : "improve"}
            sessionOnly={!materials}
            experience="chat"
            area={area}
            searchTarget={
              model.searchTarget?.areaId === area.id ? model.searchTarget.target : undefined
            }
            storageNamespace={namespace}
            activityOverride={materials ? "materials" : undefined}
            duplicateCandidates={
              model.workspace ? workspaceDuplicateCandidates(model.workspace) : []
            }
            reviewEvents={model.workspace?.reviewEvents ?? []}
            api={model.tutorApi}
            createId={Crypto.randomUUID}
            mayWrite={() =>
              !model.workspaceLifetime.isBlocked() &&
              model.workspaceLifetime.generation() === model.operationGeneration &&
              model.cacheWritable
            }
            onApproveProposal={(proposal, proposalId, sessionId) =>
              model.approveTutorProposal(proposal, proposalId, sessionId, area.id)
            }
            onStartReview={() => {
              model.startStudy(area.id);
            }}
          />
        </View>
      )}
    </View>
  );
}
