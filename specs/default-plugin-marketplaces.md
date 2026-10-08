# 默认插件市场（Default Plugin Marketplaces）

## 背景与目标

官方 ZCode 产品预置两个市场源：自运营的 `zcode-plugins-official`（CDN）与 Claude Code
扩展目录 `claude-plugins-official`（GitHub `anthropics/claude-plugins-official`）。本仓库
（OpenZCode）开源快照里只保留了前者，导致用户无法浏览/安装 Claude Code 生态插件。本 spec
恢复第二个默认市场源，同时保持 OpenZCode 既有产品规则不被冲垮：商店"公开分段"仍然只呈现
OpenZCode 官方市场。

## 规则

### 市场身份与所有者

- **默认市场清单的唯一所有者**：`packages/shared/src/plugin-marketplaces.ts` 的
  `DEFAULT_PLUGIN_MARKETPLACES`，按序包含：
  1. `zcode-plugins-official`（source: CDN marketplace.json URL）
  2. `claude-plugins-official`（source: GitHub `anthropics/claude-plugins-official`）
- **官方 id 保留身份的唯一所有者**：`apps/zcode-cli/packages/contracts/src/plugins/index.ts`
  的 `isOfficialMarketplaceId`，接受上述两个 id。语义与官方产品一致：官方 id 是保留身份，
  workspace 配置声明同 id 异 source 只产生诊断、不得替换官方缓存投影；市场 manifest 改名
  冒用官方 id 时 trustedId 守卫拒绝刷新。
- **商店"公开分段"规则不变**：`PUBLIC_STORE_MARKETPLACE_IDS` 仍只含
  `zcode-plugins-official`。`claude-plugins-official` 的目录走商店"个人分段"按市场分组
  展示（可搜索、可安装），不进 Featured/分类区块。
- 两个概念（默认市场 / 公开分段市场）刻意分离：默认市场回答"预置了哪些来源"，
  公开分段回答"商店首页策展哪些来源"。

### 登记与生命周期

- `ensureDefaultPluginMarketplaces`（adapters）在既有入口自愈式补种缺失的默认市场：
  只追加 `known_marketplaces.json` 里缺失的 id，不触碰用户自建市场，不改已存在记录。
- 默认市场**不可移除**（UI 来源管理不渲染删除入口）：移除后下次启动会被重新补种，
  只会造成"删了又回来"的困惑。可移除判定从"非公开分段市场"改为"非默认市场"。
- 默认市场 manifest 懒加载：登记只写 known 记录，目录（marketplace.json）在商店页
  Catalog Auto-Refresh 或显式刷新/安装流程时拉取进缓存。

### Catalog Auto-Refresh

自动刷新从"只覆盖 OpenZCode 官方市场"扩展为"覆盖全部默认市场"（节流与防抖判据不变，
按 marketplace id 各自记账）。否则第二个默认市场登记后目录恒为空，用户必须手动刷新。

### 目录图标注入（Claude 市场图标）

Claude Code 上游目录（`anthropics/claude-plugins-official`）的条目不含 `icon` 字段；官方
ZCode 桌面端展示的 Claude 插件图标，是客户端在物化市场目录时从自家 CDN 的图标名单合并出来
的。OpenZCode 恢复同一机制：

- **名单来源**：`https://cdn-zcode.z.ai/zcode/official-plugin/assets/icon-sources.json`，
  条目形如 `{name, icon: "<插件目录>/icon.png", mimeType}`；最终 icon URL = assets 基址 +
  `icon` 值（相对路径拼接，已是 http(s) 绝对地址则原样使用）。
- **注入点**：`addMarketplace`（安装/刷新/懒物化的唯一汇聚点）在官方 id 守卫通过后、持久化
  之前，仅当 `manifest.name` 为 `claude-plugins-official` 时执行合并；写入条目 `icon` 字段。
  条目已带 icon 不覆盖（上游未来自带图标优先）；名单里没有的插件保持无图标。
- **失败语义**：名单拉取/解析失败不阻塞市场安装与刷新，回退到上次成功名单的缓存
  （`<pluginStorageRoot>/icon-sources.json`，与官方 ZCode 同布局）；两者皆无则本次目录
  无图标。名单超时独立设短值，不拖慢整个市场刷新。
- **渲染零改动**：icon 经 `parseEntryStoreListing` 进入 listing，按既有信任规则（https://）
  渲染，缺失时字母头像降级。

## 边界

- 内置插件（bundled seed、restorable、node-repl-host 等）仍只归属 `zcode-plugins-official`，
  与 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 一样不因本规则扩大。
- workspace/CLI 的市场声明诊断、`plugin_marketplace_declaration_reserved` 语义对两个
  官方 id 一视同仁。
- 离线或 GitHub 不可达：claude 市场登记存在但目录为空（pluginCount 0），刷新失败走既有
  `refreshFailure` 展示，不阻塞商店其余部分。
- 已存在的 `known_marketplaces.json` 无需迁移：补种逻辑天然把缺失 id 追加进去。

## 验收场景

1. 全新 storage root 启动后，`known_marketplaces.json` 同时含两个默认市场，顺序与清单一致；
   用户自建市场不被去重或改写。
2. 已有只含 `zcode-plugins-official` 的旧 storage root：下次进入插件相关流程后自动补上
   `claude-plugins-official`，原记录字段（addedAt/pluginCount 等）不变。
3. 商店页来源管理：两个默认市场置顶（zcode 在前）且无删除按钮，可手动刷新；自定义市场
   可刷新可删除。
4. 进入商店页后，两个默认市场在节流窗口外各自动刷新一次；claude 目录拉取成功后其插件
   出现在"个人"分段对应市场分组，搜索可命中。
5. `isOfficialMarketplaceId("claude-plugins-official")` 为 true；workspace 声明同 id 异
   source 产生保留身份诊断而非替换缓存。
6. 公开分段（Featured/分类）不出现 claude 市场条目。
7. claude 市场物化（安装/刷新）且名单可用：缓存 marketplace.json 的条目按名带 icon，
   名单缓存落盘 `icon-sources.json`；条目已有 icon 不被覆盖。
8. 名单拉取失败但有历史缓存：目录照常物化，图标来自缓存；两者皆无：目录无图标、
   加载成功，商店降级字母头像。
9. 非 claude 市场不触发名单拉取，条目不被注入图标。
