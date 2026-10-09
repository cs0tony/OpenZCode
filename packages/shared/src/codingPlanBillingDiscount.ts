import { z } from "zod";

/**
 * 服务端 `configs.codingPlanBillingDiscount` 的按 locale 键控活动文案
 * （specs/coding-plan-billing-discount-badge.md）。
 *
 * 全部字段可选：徽标、卡片、活动说明由服务端活动运营独立配置，
 * 解析与取值都不做字段间联动假设。
 */
export const codingPlanBillingDiscountLocaleCopySchema = z.object({
  badgeBody: z.string().nullish(),
  cardTitle: z.string().nullish(),
  cardBody: z.string().nullish(),
  infoTitle: z.string().nullish(),
  infoBody: z.string().nullish(),
});

export type CodingPlanBillingDiscountLocaleCopy = z.infer<
  typeof codingPlanBillingDiscountLocaleCopySchema
>;

export type CodingPlanBillingDiscountConfig = Record<string, CodingPlanBillingDiscountLocaleCopy>;

/**
 * 解析服务端活动配置；缺失或结构非法返回 null（fail-closed，按「无活动」处理）。
 * 不透出畸形文案给渲染层。
 */
export function parseCodingPlanBillingDiscount(
  raw: unknown,
): CodingPlanBillingDiscountConfig | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const parsed = z.record(z.string(), codingPlanBillingDiscountLocaleCopySchema).safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) {
    return null;
  }
  return parsed.data;
}

export interface ResolvedCodingPlanBillingDiscountCopy {
  readonly locale: string;
  readonly badgeBody: string | null;
  readonly cardTitle: string | null;
  readonly cardBody: string | null;
  readonly infoTitle: string | null;
  readonly infoBody: string | null;
  /** 徽标正文非空：徽标 pill 的渲染条件之一。 */
  readonly hasBadge: boolean;
  /** 活动说明标题与正文均非空：tooltip 的渲染条件。 */
  readonly hasInfo: boolean;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasAnyContent(copy: CodingPlanBillingDiscountLocaleCopy): boolean {
  return (
    nonEmpty(copy.badgeBody) !== null ||
    nonEmpty(copy.cardTitle) !== null ||
    nonEmpty(copy.cardBody) !== null ||
    nonEmpty(copy.infoTitle) !== null ||
    nonEmpty(copy.infoBody) !== null
  );
}

/**
 * locale 回退链：当前 locale → zh-CN → en-US → 第一个有内容的 locale。
 * 整个 config 无可用文案时返回 null。
 */
export function resolveCodingPlanBillingDiscountCopy(
  config: CodingPlanBillingDiscountConfig | null | undefined,
  locale: string,
): ResolvedCodingPlanBillingDiscountCopy | null {
  if (!config) {
    return null;
  }
  const candidates = [locale, "zh-CN", "en-US"].map((key) =>
    key in config ? config[key] : undefined,
  );
  const copy =
    candidates.find((entry) => entry && hasAnyContent(entry)) ??
    Object.values(config).find((entry) => entry && hasAnyContent(entry));
  if (!copy || !hasAnyContent(copy)) {
    return null;
  }
  const badgeBody = nonEmpty(copy.badgeBody);
  const infoTitle = nonEmpty(copy.infoTitle);
  const infoBody = nonEmpty(copy.infoBody);
  return {
    locale,
    badgeBody,
    cardTitle: nonEmpty(copy.cardTitle),
    cardBody: nonEmpty(copy.cardBody),
    infoTitle,
    infoBody,
    hasBadge: badgeBody !== null,
    hasInfo: infoTitle !== null && infoBody !== null,
  };
}
