# Coding Plan 活动说明徽标（billing discount badge）

## 行为

模型设置的官方编程套餐（bigmodel / zai Coding Plan）状态卡上方展示服务端下发的营销活动徽标（如「150% 配额」），徽标可查看活动说明；用户可通过卡片上方的开关整体开启/关闭该活动信息展示。

与官方 ZCode 客户端对齐：徽标内容完全来自服务端活动配置，客户端不硬编码活动数值（入口无障碍标签除外）。

## 数据链路与所有者

```text
服务端 /api/v1/client/configs（configs.codingPlanBillingDiscount）
  → BigModelCodingPlanSubscriptionProvider.getClientConfigs()
    （1h 快照 + 单飞合并，唯一取数点，与套餐目录/灰度共享同一份快照）
  → codingPlanSubscriptionService.getCodingPlanBillingDiscount()   ← Host 侧唯一决策者
  → renderer codingPlanBillingDiscountStore                        ← app 会话级唯一副本
    （Root loader 每会话取一次；失败 fail-closed 置 null，不记住失败，service 换实例可重试）
  → CodingPlanBillingDiscountSection（Detail 页官方套餐卡上方，只读）
  → codingPlanBillingDiscountDisplayStore                          ← 开关唯一所有者
    （本地持久化 UI 偏好，默认开启；不广播、不进 appSettings）
```

事件顺序：Root 挂载 → loader `ensureLoaded`（同 service 实例幂等，并发合并）→ store `ready` → Detail 区块渲染。`forceRefresh` 预留（绕过 1h 快照），首期无调用方。

## 配置结构（服务端下发）

`configs.codingPlanBillingDiscount`：按 locale 键控的文案对象，每个 locale 可含 `badgeBody / cardTitle / cardBody / infoTitle / infoBody`（均可选字符串）。解析失败或缺失按「无活动」处理。

locale 取值回退链：当前 locale → `zh-CN` → `en-US` → 第一个有内容的 locale。

## 展示与门控

- Start Plan 不参与活动：选中的是 Start Plan 时，徽标与开关都不渲染（官方活动中只有付费 Coding Plan）。
- 徽标位置：与官方 ZCode 一致，渲染在套餐状态卡**套餐名称右侧**（`CodingPlanStatusPanel` 的 `titleAccessory`，紧凑尺寸）。
- 开关位置：官方套餐状态卡**上方**一行，仅含「显示活动信息」开关；徽标不在此行。
- 区块整体可见性：store `ready` 且解析出有内容的文案。服务端无活动 / 请求失败 → 徽标与开关整体不渲染（fail-closed）。
- 徽标可见性：非 Start Plan && 区块可见 && 用户开关开启 && `badgeBody` 非空。
- 活动说明：`infoTitle` 与 `infoBody` 均非空时，徽标 hover 展示 tooltip；仅作为徽标的补充信息，不单独渲染。
- 开关状态不隐藏开关本身（开关始终可见），只控制徽标与说明展示。

## 失败语义

- 配置读取失败：按「无活动」处理（warn 日志，不抛出），不阻断套餐卡渲染。
- 解析失败：同上；不允许畸形文案进入渲染层。

## 验收场景

1. 选中付费 Coding Plan 且服务端下发含 `zh-CN` 徽标文案的活动配置：套餐名称右侧出现徽标（紧凑 pill），hover 可见说明；套餐卡上方出现开关，关闭后徽标消失、开关保留。
2. 选中 Start Plan：不渲染徽标与开关。
3. 服务端未下发配置或下发非法结构：不渲染徽标与开关，无报错。
4. 请求失败后恢复：重进 app（或 service 实例更换）可重新取数并展示。
5. 开关偏好持久化：重启 app 后保持用户上次选择。
