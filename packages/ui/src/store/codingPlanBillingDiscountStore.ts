import { create } from "zustand";
import type { CodingPlanBillingDiscountConfig } from "@zcode/shared";
import type { ICodingPlanSubscriptionService } from "@zcode/services";
import { logger } from "@/logger.js";

// ============================================================
// Coding Plan 活动文案在 renderer 的唯一副本
// （specs/coding-plan-billing-discount-badge.md）
// ============================================================
//
// Host 是唯一决策者，这里只缓存它给出的那一份活动配置：
//   - 一个 app 会话只取一次。发请求的是 Root 里的 loader（唯一 owner），
//     模型设置页只读，不各自再发一次；
//   - 不带 forceRefresh：Host 用同一份 1h 快照，renderer 单独 force 一次没有收益；
//   - 请求失败按「无活动」处理（config = null，fail-closed），但**不记住失败**：
//     换一份 service 实例会重试。手机 `/remote` 在工作区桥接前拿到的是 unsupported 代理，
//     必然抛错，桥接完成后 accessor 会换一份，那一次必须能纠正回来。

export type CodingPlanBillingDiscountStatus = "loading" | "ready";

export interface CodingPlanBillingDiscountSnapshot {
  readonly status: CodingPlanBillingDiscountStatus;
  /** loading 或失败时为 null；null 即「无活动」，展示区块整体隐藏。 */
  readonly config: CodingPlanBillingDiscountConfig | null;
}

interface CodingPlanBillingDiscountState extends CodingPlanBillingDiscountSnapshot {
  /** 首次取数；同一个 service 出过结果后是 no-op，并发调用共用同一次请求。 */
  ensureLoaded(service: ICodingPlanSubscriptionService): Promise<void>;
}

const INITIAL_SNAPSHOT: CodingPlanBillingDiscountSnapshot = {
  status: "loading",
  config: null,
};

let inFlight: Promise<void> | null = null;
/** 已经出过结果（成功或失败）的 service 实例；同一实例不再重复请求。 */
let settledService: ICodingPlanSubscriptionService | null = null;

async function loadBillingDiscountConfig(
  service: ICodingPlanSubscriptionService,
  publish: (snapshot: CodingPlanBillingDiscountSnapshot) => void,
): Promise<void> {
  try {
    const config = await service.getCodingPlanBillingDiscount();
    publish({ status: "ready", config });
  } catch (error) {
    logger.warn(
      "[coding-plan-billing-discount] 活动配置读取失败，按无活动处理",
      error instanceof Error ? error.message : String(error),
    );
    publish({ status: "ready", config: null });
  } finally {
    settledService = service;
  }
}

export const useCodingPlanBillingDiscountStore = create<CodingPlanBillingDiscountState>(
  (set, get) => ({
    ...INITIAL_SNAPSHOT,

    ensureLoaded(service): Promise<void> {
      if (settledService === service) return Promise.resolve();
      if (inFlight) {
        // 在途的可能是另一份 service（手机 `/remote` 桥接期间 accessor 会换）：排在它后面再判一次。
        return inFlight.then(() => get().ensureLoaded(service));
      }
      const run = loadBillingDiscountConfig(service, set).finally(() => {
        if (inFlight === run) inFlight = null;
      });
      inFlight = run;
      return run;
    },
  }),
);
