# 欢迎页启动展示规则（Welcome Screen Startup Gate）

## 背景与目标

欢迎页（`WelcomeScreen`）承担首次引导：连接官方账号（OAuth）或配置 API Key。此前启动门禁为
`!providerFamilyDomain || (!user && !hasUsableProvider)`，其中 `providerFamilyDomain` 只由
OAuth 登录、欢迎页"跳过"、设置页点击预设导航项三个入口写入；而"保存任意可用 API Key"
（欢迎页表单或设置页添加供应商，含第三方供应商）不会写它。这导致已经配好可用凭据的用户
在每次启动时仍被全屏欢迎页拦截，与门禁注释声明的意图（"未登录且没有可用模型配置时才引导"）相悖。

## 规则

启动时展示欢迎页，当且仅当：

```
!user && !hasUsableProvider
```

- `user`：OAuth 会话恢复出的登录账号；登录过即视为已完成引导。
- `hasUsableProvider`：模型注册表（`ModelSelectionView.providers`）中存在至少一个带可执行模型的
  provider。计入口径与来源无关：欢迎页 API Key 表单、设置页"添加供应商"（智谱四个预设、
  第三方模板、自定义 provider）均计入。
- `providerFamilyDomain` 不再参与启动判定。它回归纯粹的"家族归属"语义（OAuth 登录、跳过、
  设置页导航项写入），供套餐身份、额度面板、连接方式记忆等消费。

## 边界

- 欢迎页"跳过"是会话级动作：只关闭当次欢迎页，不产生任何持久化豁免；下次启动仍按上述公式判定。
- 欢迎页之外的开机触发（JWT 过期、登出后 provider 失效、会话内登录请求）沿用各自的 reason，
  不受本规则影响。
- provider 读取失败时不得误判为"无可用 provider"：沿用现有"结束门禁等待、不弹欢迎页"的分支。

## 欢迎页入口（providers 模式按钮栈）

"使用 API key"按钮下方固定提供两个入口：

1. **添加供应商**：深链设置页 → 模型供应商分区，并自动打开"添加供应商"选择器
   （`setPendingSettingsSectionIntent("modelProvider", { modelProviderAddProvider: true })` +
   打开设置 tab）；欢迎页经 `LoginCompleteReason = "openProviderSettings"` 走统一 complete 流程
   关闭（启动自动弹出时会顺带创建默认 workspace）。
2. **暂时跳过**：与 API Key 表单内的跳过同语义——写 `providerFamilyDomain` 确认家族归属
   （默认取 locale 推断的家族）后以 `"skip"` complete。差异：欢迎页没有错误展示位，域确认
   写入失败仅告警并放行退出，避免存储异常把用户困在欢迎页（启动门禁已不依赖该字段）。

## 验收场景

1. 全新安装（未登录、无任何 provider）：展示欢迎页。
2. 欢迎页保存智谱 API Key 后重启：不展示。
3. 设置页添加任意第三方供应商 API Key（未登录、未点过跳过/导航项）后重启：不展示。
4. OAuth 登录后重启：不展示（无论是否配置 provider）。
5. 未登录、无 provider，点"跳过"进入工作区后重启：再次展示欢迎页（跳过为会话级）。
