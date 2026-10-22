import type { Workspace } from "@recall/domain";
import {
  adaptStudyCommandSave,
  useStudyCommand,
  type StudyCommandPromiseSave,
} from "@recall/react";
export type NativeStudyCommand = StudyCommandPromiseSave;
export function useNativeStudyCommand(workspace: Workspace, save: NativeStudyCommand | undefined) {
  return useStudyCommand(workspace, save ? adaptStudyCommandSave(save) : undefined);
}
