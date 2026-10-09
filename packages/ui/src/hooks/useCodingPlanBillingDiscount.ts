import { useEffect, useMemo } from "react";
import type { ICodingPlanSubscriptionService } from "@zcode/services";
import {
  useCodingPlanBillingDiscountStore,
  type CodingPlanBillingDiscountSnapshot,
} from "@/store/codingPlanBillingDiscountStore.js";

/**
 * 读 Coding Plan 活动配置快照。
 * 只读，不触发请求：取数由 Root 里的 loader 唯一负责（specs/coding-plan-billing-discount-badge.md）。
 */
export function useCodingPlanBillingDiscount(): CodingPlanBillingDiscountSnapshot {
  // 逐字段订阅：返回对象字面量的 selector 每次都是新引用，useSyncExternalStore 会判定为变化。
  const status = useCodingPlanBillingDiscountStore((state) => state.status);
  const config = useCodingPlanBillingDiscountStore((state) => state.config);
  return useMemo(() => ({ status, config }), [config, status]);
}

/**
 * app 会话级取数，挂在 Root 里一次。service 换了（手机 `/remote` 完成工作区桥接）会重试，
 * 取数与失败重试的规则见 codingPlanBillingDiscountStore。
 */
export function useCodingPlanBillingDiscountLoader(service: ICodingPlanSubscriptionService): void {
  const ensureLoaded = useCodingPlanBillingDiscountStore((state) => state.ensureLoaded);
  useEffect(() => {
    void ensureLoaded(service);
  }, [ensureLoaded, service]);
}
