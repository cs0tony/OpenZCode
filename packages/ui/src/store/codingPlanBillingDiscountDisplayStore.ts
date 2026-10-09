import { create } from "zustand";
import { logger } from "@/logger.js";

// ============================================================
// Coding Plan 活动信息展示开关（specs/coding-plan-billing-discount-badge.md）
// ============================================================
//
// 纯本地 UI 偏好的唯一所有者：只控制徽标与活动说明是否展示，
// 不影响服务端配置拉取与活动状态本身。默认开启，与官方 ZCode 客户端行为对齐；
// localStorage 持久化让重启后保持用户选择。不广播、不进 appSettings。

const STORAGE_KEY = "zcode.codingPlanBillingDiscountDisplay";

interface CodingPlanBillingDiscountDisplayState {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
}

function readInitialEnabled(): boolean {
  try {
    // 缺失即默认开启；非法值同样回落默认，避免坏数据永久关闭活动展示。
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

function persistEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch (error) {
    logger.warn(
      "[coding-plan-billing-discount] 展示开关持久化失败",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export const useCodingPlanBillingDiscountDisplayStore =
  create<CodingPlanBillingDiscountDisplayState>((set) => ({
    enabled: readInitialEnabled(),
    setEnabled(enabled) {
      persistEnabled(enabled);
      set({ enabled });
    },
  }));
