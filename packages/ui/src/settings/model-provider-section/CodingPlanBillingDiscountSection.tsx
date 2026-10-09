import { Sparkles } from "lucide-react";
import { resolveCodingPlanBillingDiscountCopy } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Switch } from "@/components/ui/switch.js";
import { useCodingPlanBillingDiscount } from "@/hooks/useCodingPlanBillingDiscount.js";
import { useCodingPlanBillingDiscountDisplayStore } from "@/store/codingPlanBillingDiscountDisplayStore.js";

/**
 * 活动徽标 pill（specs/coding-plan-billing-discount-badge.md）：
 * 紧凑版，渲染在套餐名称右侧（CodingPlanStatusPanel 的 titleAccessory）。
 * 正文来自服务端 badgeBody；说明（infoTitle/infoBody 均非空）通过 tooltip 展示。
 * 配置未就绪 / 无活动 / 用户关闭展示时返回 null。
 */
export function CodingPlanBillingDiscountBadge() {
  const { intl, locale } = useZCodeIntl();
  const { status, config } = useCodingPlanBillingDiscount();
  const enabled = useCodingPlanBillingDiscountDisplayStore((state) => state.enabled);

  if (status !== "ready" || !enabled) {
    return null;
  }
  const copy = resolveCodingPlanBillingDiscountCopy(config, locale);
  if (!copy?.badgeBody) {
    return null;
  }

  const badge = (
    <span
      role="status"
      aria-label={intl.formatMessage({
        id: "settings.modelProvider.codingPlan.billingDiscountInfo.open",
      })}
      className="inline-flex cursor-default items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 text-ui-xs leading-none text-white button-gradient dark:bg-[#484A58]"
    >
      <Sparkles aria-hidden={true} className="size-2.5" />
      {copy.badgeBody}
    </span>
  );
  if (!copy.hasInfo) {
    return badge;
  }
  return (
    <ControlHintTooltip
      title={copy.infoTitle ?? ""}
      description={copy.infoBody ?? undefined}
      standalone
    >
      {badge}
    </ControlHintTooltip>
  );
}

/**
 * 官方编程套餐卡上方的活动信息开关行（specs/coding-plan-billing-discount-badge.md）。
 *
 * 只渲染开关本身，徽标在套餐名称右侧（CodingPlanBillingDiscountBadge）。
 * 展示门控：服务端下发了有内容的活动文案才渲染（含开关），无活动时整体不出现；
 * 开关是纯本地 UI 偏好（codingPlanBillingDiscountDisplayStore），只控制展示。
 */
export function CodingPlanBillingDiscountSection() {
  const { intl, locale } = useZCodeIntl();
  const { status, config } = useCodingPlanBillingDiscount();
  const enabled = useCodingPlanBillingDiscountDisplayStore((state) => state.enabled);
  const setEnabled = useCodingPlanBillingDiscountDisplayStore((state) => state.setEnabled);

  if (status !== "ready") {
    return null;
  }
  if (!resolveCodingPlanBillingDiscountCopy(config, locale)) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-ui-xs text-foreground-subtle">
        {intl.formatMessage({
          id: "settings.modelProvider.codingPlan.billingDiscountInfo.toggle",
        })}
      </span>
      <Switch
        checked={enabled}
        onCheckedChange={setEnabled}
        aria-label={intl.formatMessage({
          id: "settings.modelProvider.codingPlan.billingDiscountInfo.toggle",
        })}
      />
    </div>
  );
}
