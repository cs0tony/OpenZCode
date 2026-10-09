import { useRef, useState } from "react";
import { Folder, FolderPlus, X } from "lucide-react";
import type { ProjectWorkspace } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  appendProjectWorkspaceDraftFolder,
  getProjectWorkspaceDraftErrorKind,
  removeProjectWorkspaceDraftFolder,
  type ProjectWorkspaceCommitResult,
  type ProjectWorkspaceDraft,
  type ProjectWorkspaceDraftErrorKind,
} from "@/project-workspace/projectWorkspaceDraft.js";

function getProjectWorkspaceDraftErrorMessage(
  errorKind: ProjectWorkspaceDraftErrorKind,
): string {
  switch (errorKind) {
    case "nameRequired":
      return "projectWorkspace.error.nameRequired";
    case "foldersRequired":
      return "projectWorkspace.error.foldersRequired";
    case "primaryRequired":
      return "projectWorkspace.error.primaryRequired";
  }
}

function buildInitialDraft(
  mode: "create" | "edit",
  project: ProjectWorkspace | null,
): ProjectWorkspaceDraft {
  if (mode === "edit" && project) {
    return {
      id: project.id,
      name: project.name,
      folderPaths: [...project.folderPaths],
      primaryFolderPath: project.primaryFolderPath,
    };
  }
  return { name: "", folderPaths: [], primaryFolderPath: "" };
}

/**
 * 项目工作区创建/编辑弹窗（specs/project-workspace-multi-folder.md）。
 * 元数据只经 onCommit 写入用户级 settings，绝不写进任何项目文件夹；
 * 移除 primary 时不做静默晋升，必须显式重选主文件夹才能提交。
 * 初始化依赖调用方按请求给 key 重挂载（Root 侧），不用 effect 回填，
 * 避免 settings 快照刷新（project 对象换引用）把用户正在编辑的草稿重置。
 */
export function ProjectWorkspaceDialog({
  mode,
  project,
  selectFolder,
  onCommit,
  onDelete,
  onClose,
}: {
  mode: "create" | "edit";
  project: ProjectWorkspace | null;
  selectFolder: () => Promise<string | null>;
  onCommit: (draft: ProjectWorkspaceDraft) => Promise<ProjectWorkspaceCommitResult>;
  onDelete?: (projectId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { intl } = useZCodeIntl();
  const requestConfirmation = useConfirmDialog();
  const [draft, setDraft] = useState<ProjectWorkspaceDraft>(() =>
    buildInitialDraft(mode, project),
  );
  const [errorText, setErrorText] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const compositionActiveRef = useRef(false);

  const handleAddFolder = async () => {
    const folderPath = await selectFolder();
    if (!folderPath) {
      return;
    }
    setErrorText(null);
    setDraft((current) => appendProjectWorkspaceDraftFolder(current, folderPath));
  };

  const handleConfirm = async () => {
    const nextErrorKind = getProjectWorkspaceDraftErrorKind(draft);
    if (nextErrorKind) {
      setErrorText(
        intl.formatMessage({ id: getProjectWorkspaceDraftErrorMessage(nextErrorKind) }),
      );
      return;
    }
    setCommitting(true);
    try {
      const result = await onCommit({ ...draft, name: draft.name.trim() });
      if (!result.ok) {
        setErrorText(
          intl.formatMessage({ id: "projectWorkspace.error.duplicatePrimary" }),
        );
        return;
      }
      if (result.outcome === "absorbedPlainFolder") {
        // tab 身份按路径匹配，同路径普通 tab 无法与项目 tab 共存；
        // 并入时明确提示，避免用户以为原来打开的文件夹丢了。
        toast(intl.formatMessage({ id: "projectWorkspace.hint.absorbedFolder" }));
      }
      onClose();
    } catch (error) {
      logger.error("[ProjectWorkspaceDialog] commit failed", error);
      setErrorText(intl.formatMessage({ id: "projectWorkspace.error.commitFailed" }));
    } finally {
      setCommitting(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id || !onDelete) {
      return;
    }
    const confirmed = await requestConfirmation({
      title: intl.formatMessage({ id: "projectWorkspace.deleteConfirmTitle" }),
      description: intl.formatMessage({ id: "projectWorkspace.deleteConfirmDescription" }),
      confirmLabel: intl.formatMessage({ id: "projectWorkspace.delete" }),
      cancelLabel: intl.formatMessage({ id: "common.cancel" }),
    });
    if (!confirmed) {
      return;
    }
    await onDelete(draft.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        onClose();
      }
    }}>
      <DialogContent className="max-w-xl overflow-hidden rounded-2xl p-0">
        <div className="flex min-w-0 flex-col gap-6 p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle>
              {intl.formatMessage({
                id: mode === "edit" ? "projectWorkspace.editTitle" : "projectWorkspace.createTitle",
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-5">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-ui-sm font-medium text-foreground-subtle">
                {intl.formatMessage({ id: "projectWorkspace.nameLabel" })}
              </span>
              <Input
                value={draft.name}
                size="lg"
                placeholder={intl.formatMessage({ id: "projectWorkspace.namePlaceholder" })}
                onChange={(event) => {
                  setErrorText(null);
                  setDraft((current) => ({ ...current, name: event.target.value }));
                }}
                onCompositionEnd={() => {
                  compositionActiveRef.current = false;
                }}
                onCompositionStart={() => {
                  compositionActiveRef.current = true;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !isImeComposingKeyEvent({
                      compositionActive: compositionActiveRef.current,
                      nativeEvent: event.nativeEvent,
                    })
                  ) {
                    event.preventDefault();
                    void handleConfirm();
                  }
                }}
              />
            </label>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ui-sm font-medium text-foreground-subtle">
                  {intl.formatMessage({ id: "projectWorkspace.foldersLabel" })}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void handleAddFolder();
                  }}
                >
                  <FolderPlus className="size-4" aria-hidden="true" />
                  {intl.formatMessage({ id: "projectWorkspace.addFolder" })}
                </Button>
              </div>
              <ul className="flex min-w-0 flex-col gap-0.5">
                {draft.folderPaths.map((folderPath) => {
                  const isPrimary = draft.primaryFolderPath === folderPath;
                  return (
                    <li
                      key={folderPath}
                      className="group/row flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                    >
                      <Folder
                        className="size-4 shrink-0 text-foreground-subtle"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-foreground">
                        {folderPath}
                      </span>
                      {isPrimary ? (
                        // 主要源文件夹：右侧常显"主要"徽标。
                        <span className="shrink-0 rounded-sm bg-accent px-1.5 py-0.5 text-ui-xs text-accent-foreground">
                          {intl.formatMessage({ id: "projectWorkspace.primaryBadge" })}
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-6 shrink-0 px-2 text-ui-xs text-foreground-subtle opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:text-foreground"
                          onClick={() => {
                            setErrorText(null);
                            setDraft((current) => ({
                              ...current,
                              primaryFolderPath: folderPath,
                            }));
                          }}
                        >
                          {intl.formatMessage({ id: "projectWorkspace.setPrimary" })}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-foreground-subtle hover:text-foreground"
                        aria-label={intl.formatMessage({ id: "projectWorkspace.removeFolder" })}
                        onClick={() => {
                          setErrorText(null);
                          setDraft((current) =>
                            removeProjectWorkspaceDraftFolder(current, folderPath),
                          );
                        }}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "projectWorkspace.primaryHint" })}
              </p>
            </div>
            {errorText ? <p className="text-ui-sm text-destructive">{errorText}</p> : null}
          </div>
          <DialogFooter className="flex items-center justify-between gap-3">
            {mode === "edit" && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-10 min-w-0 px-5 text-destructive hover:text-destructive"
                disabled={committing}
                onClick={() => {
                  void handleDelete();
                }}
              >
                {intl.formatMessage({ id: "projectWorkspace.delete" })}
              </Button>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="h-10 min-w-0 px-5"
                disabled={committing}
                onClick={onClose}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
              <Button
                type="button"
                size="lg"
                className="h-10 min-w-0 px-5"
                disabled={committing}
                onClick={() => {
                  void handleConfirm();
                }}
              >
                {intl.formatMessage({ id: "common.confirm" })}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
