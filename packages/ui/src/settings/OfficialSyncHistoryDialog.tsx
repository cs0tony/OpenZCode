import { useEffect, useMemo } from "react";
import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ZCodeOfficialSyncHistoryEntry } from "@zcode/shared";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import type { IPluginManagementService } from "@zcode/services";

/**
 * 内置插件同步历史（specs/official-plugin-sync-history.md）。
 * pluginName 为空时展示整表历史（激活=整表回退）；指定 pluginName 时展示该插件的
 * 历史版本（激活=单插件回退），并额外提供"移除此插件"（回退到未同步状态）。
 */
export function OfficialSyncHistoryDialog({
  open,
  onOpenChange,
  pluginName,
  pluginLabel,
  pluginService,
  onActivated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginName?: string;
  pluginLabel?: string;
  pluginService: IPluginManagementService;
  onActivated?: () => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const history = usePluginManagementStore((state) => state.officialSyncHistory);
  const loadOfficialSyncHistory = usePluginManagementStore(
    (state) => state.loadOfficialSyncHistory,
  );
  const activateOfficialSyncHistoryEntry = usePluginManagementStore(
    (state) => state.activateOfficialSyncHistoryEntry,
  );
  const activateOfficialPluginHistoryVersion = usePluginManagementStore(
    (state) => state.activateOfficialPluginHistoryVersion,
  );
  const operationId = usePluginManagementStore((state) => state.operationId);
  // 打开时懒加载（sync 成功会把 loaded 置 false，重开面板即拿到最新历史）。
  useEffect(() => {
    if (open) void loadOfficialSyncHistory(pluginService);
  }, [loadOfficialSyncHistory, open, pluginService]);
  const activating = operationId !== null;
  const activeKeys = useMemo(
    () => new Set(history.active.map((state) => `${state.plugin}@${state.version}@${state.hash}`)),
    [history.active],
  );
  const pluginVersions = useMemo(() => {
    if (!pluginName) return [];
    const latestByState = new Map<string, { capturedAt: string; hash: string; version: string }>();
    for (const entry of history.entries) {
      const state = entry.plugins.find((candidate) => candidate.plugin === pluginName);
      if (!state) continue;
      const existing = latestByState.get(state.hash);
      if (!existing || entry.createdAt > existing.capturedAt) {
        latestByState.set(state.hash, {
          capturedAt: entry.createdAt,
          hash: state.hash,
          version: state.version,
        });
      }
    }
    return [...latestByState.values()].sort((left, right) =>
      right.capturedAt.localeCompare(left.capturedAt),
    );
  }, [history.entries, pluginName]);
  const pluginCurrentlyPresent = pluginName
    ? history.current.some((state) => state.plugin === pluginName)
    : false;

  const formatTime = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };
  const entryMatchesActive = (entry: ZCodeOfficialSyncHistoryEntry): boolean => {
    const toKey = (state: { hash: string; plugin: string; version: string }): string =>
      `${state.plugin}@${state.version}@${state.hash}`;
    const entryKeys = entry.plugins.map(toKey).sort();
    const activeKeysSorted = history.active.map(toKey).sort();
    return (
      entryKeys.length === activeKeysSorted.length &&
      entryKeys.every((key, index) => key === activeKeysSorted[index])
    );
  };

  // 激活结果统一 toast：成功关闭面板；失败保留面板（store error 已带具体原因）。
  const reportActivation = (
    succeeded: boolean,
    succeededMessageId: string,
    failedMessageId: string,
  ): boolean => {
    if (succeeded) {
      toast(intl.formatMessage({ id: succeededMessageId }));
      onActivated?.();
      onOpenChange(false);
      return true;
    }
    toast(
      usePluginManagementStore.getState().error ?? intl.formatMessage({ id: failedMessageId }),
      { variant: "warning" },
    );
    return false;
  };

  const handleActivateEntry = async (entryId: string) => {
    if (activating) return;
    reportActivation(
      await activateOfficialSyncHistoryEntry(entryId, pluginService),
      "settings.plugins.syncHistory.activated",
      "settings.plugins.syncHistory.failed",
    );
  };
  const handleActivateVersion = async (version: string, hash: string) => {
    if (activating || !pluginName) return;
    reportActivation(
      await activateOfficialPluginHistoryVersion(pluginName, version, hash, pluginService),
      "settings.plugins.pluginHistory.activated",
      "settings.plugins.pluginHistory.failed",
    );
  };
  const handleRemovePlugin = async () => {
    if (activating || !pluginName) return;
    reportActivation(
      await activateOfficialPluginHistoryVersion(pluginName, undefined, undefined, pluginService),
      "settings.plugins.pluginHistory.removed",
      "settings.plugins.pluginHistory.failed",
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="plugin-settings-sync-history-dialog"
        className="flex max-h-[min(560px,calc(100vh-4rem))] w-[min(520px,calc(100vw-2rem))] max-w-none flex-col gap-4 overflow-hidden"
      >
        <div className="space-y-1">
          <DialogTitle className="text-ui-lg font-medium text-foreground">
            {pluginName
              ? intl.formatMessage(
                  { id: "settings.plugins.pluginHistory.title" },
                  {
                    plugin: pluginLabel ?? pluginName,
                  },
                )
              : intl.formatMessage({ id: "settings.plugins.syncHistory.title" })}
          </DialogTitle>
          <DialogDescription className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({
              id: pluginName
                ? "settings.plugins.pluginHistory.description"
                : "settings.plugins.syncHistory.description",
            })}
          </DialogDescription>
        </div>
        {!history.loaded && history.loadError ? (
          // 加载失败（如 CLI 尚无对应 RPC 方法、超时）必须可见可重试，
          // 不能退化为无限转圈让用户无从判断。
          <div className="space-y-3 px-1 py-4 text-ui-sm text-foreground-subtle">
            <div className="text-foreground">{history.loadError}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="plugin-settings-sync-history-retry"
              onClick={() => void loadOfficialSyncHistory(pluginService)}
            >
              {intl.formatMessage({ id: "common.retry" })}
            </Button>
          </div>
        ) : !history.loaded ? (
          <div className="flex items-center gap-2 px-1 py-6 text-ui-sm text-foreground-subtle">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {intl.formatMessage({ id: "common.loading" })}
          </div>
        ) : pluginName ? (
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {pluginVersions.length === 0 ? (
              <div className="px-1 py-6 text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "settings.plugins.pluginHistory.empty" })}
              </div>
            ) : (
              <div className="space-y-1">
                {pluginVersions.map((version) => {
                  const stateKey = `${pluginName}@${version.version}@${version.hash}`;
                  const isActive = activeKeys.has(stateKey);
                  return (
                    <div
                      key={stateKey}
                      className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                      data-testid="plugin-settings-plugin-history-row"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-ui-base font-medium text-foreground">
                            {version.version}
                          </span>
                          {isActive ? (
                            <Badge variant="secondary" className="text-ui-xs">
                              {intl.formatMessage({
                                id: "settings.plugins.pluginHistory.currentBadge",
                              })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-ui-xs text-foreground-subtle">
                          {intl.formatMessage(
                            { id: "settings.plugins.pluginHistory.capturedAt" },
                            { time: formatTime(version.capturedAt) },
                          )}
                        </div>
                      </div>
                      {isActive ? null : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={activating}
                          data-testid="plugin-settings-plugin-history-activate"
                          onClick={() => void handleActivateVersion(version.version, version.hash)}
                        >
                          {intl.formatMessage({ id: "settings.plugins.pluginHistory.activate" })}
                        </Button>
                      )}
                    </div>
                  );
                })}
                {pluginCurrentlyPresent ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                    <div className="min-w-0 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: "settings.plugins.pluginHistory.removeHint" })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activating}
                      data-testid="plugin-settings-plugin-history-remove"
                      onClick={() => void handleRemovePlugin()}
                    >
                      {intl.formatMessage({ id: "settings.plugins.pluginHistory.remove" })}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : history.entries.length === 0 ? (
          <div className="px-1 py-6 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.plugins.syncHistory.empty" })}
          </div>
        ) : (
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            <div className="space-y-1">
              {[...history.entries].reverse().map((entry) => {
                const matchesActive = entryMatchesActive(entry);
                return (
                  <div
                    key={entry.id}
                    className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                    data-testid="plugin-settings-sync-history-row"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-foreground-subtle">
                      <History className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ui-base font-medium text-foreground">
                          {intl.formatMessage({
                            id:
                              entry.kind === "initial"
                                ? "settings.plugins.syncHistory.kind.initial"
                                : "settings.plugins.syncHistory.kind.preSync",
                          })}
                        </span>
                        {matchesActive ? (
                          <Badge variant="secondary" className="text-ui-xs">
                            {intl.formatMessage({
                              id: "settings.plugins.syncHistory.currentBadge",
                            })}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-ui-xs text-foreground-subtle">
                        {formatTime(entry.createdAt)}
                        {" · "}
                        {intl.formatMessage(
                          { id: "settings.plugins.syncHistory.pluginCount" },
                          { count: entry.plugins.length },
                        )}
                        {entry.plugins.length > 0
                          ? ` · ${entry.plugins.map((state) => state.plugin).join(", ")}`
                          : ""}
                      </div>
                    </div>
                    {matchesActive ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={activating}
                        data-testid="plugin-settings-sync-history-activate"
                        onClick={() => void handleActivateEntry(entry.id)}
                      >
                        {intl.formatMessage({ id: "settings.plugins.syncHistory.activate" })}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {intl.formatMessage({ id: "common.close" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
