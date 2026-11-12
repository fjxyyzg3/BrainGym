# BrainGym MVP Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 交付可在电脑与手机使用的空间 N-back，以及 Token 登录、私人训练历史和各难度最佳成绩。

**Scope Source:** [已批准 spec](../../scope/2026-11-12-braingym-mvp.md)

**Architecture:** React 页面和无 UI 游戏引擎运行在浏览器，Fastify 托管构建产物及同源 API。SQLite 保存凭据摘要、可撤销会话和幂等成绩汇总，规则与 DTO 共享 TypeScript 模块，管理命令直接使用服务端存储。

**Tech Stack:** Node.js 24+、TypeScript、React、Vite、Fastify、Node SQLite、Node test runner、Playwright。

**Verification:** `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`、Docker 构建/持久化检查。

---

Git 上下文继承 scope prepare：当前 `main`、当前工作树；开始时无其他文件，仅本任务 spec。没有自动 commit、push、merge 授权；checkpoint 验证后记录跳过原因，不初始化长期 Git 偏好。

### Task 1: 工具链与共享规则（已完成）

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `src/shared/rules.ts`, `src/shared/contracts.ts`, `src/client/game.ts`, `tests/rules.test.ts`, `tests/game.test.ts`。

**Acceptance:** 1～5-back，N+30 次展示，30% 阈值、两类题齐全，平衡计分、时序、首次输入和中断正确。

- [x] 建立工具链；规则/引擎先提供接口桩，写真实行为测试；`npm test` 观察断言因行为缺失失败。
- [x] 实现随机出题与校验：概率抽样 0.299 匹配、0.301 不匹配；退化序列整局重抽；验证非匹配排除 N 步前位置。
- [x] 实现单调时间引擎；测试起始 N 次不可答、亮起与留空均可答、重复输入不计数、延迟 tick 不累积漂移、30 次结束与作废清理。
- [x] 聚焦测试通过后 checkpoint；记录命令及结果，未获自动提交授权则跳过提交。

### Task 2: SQLite、Token、会话与私人记录

**Files:** `src/server/store.ts`, `src/server/app.ts`, `src/server/main.ts`, `src/server/cli.ts`, `tests/server.test.ts`, `tests/cli.test.ts`。

**Acceptance:** 哈希凭据、7 天可撤销会话、旧 Token 无法重登；当前会话与开局身份一致；汇总复算、隔离、幂等、时间语义正确。

- [x] 先写 API/真实临时 SQLite 测试；接口桩返回未实现响应，使登录或保存等关键断言失败。
- [x] SQLite 用 schema version 初始化，外键、事务、唯一键 `(user_id, result_id)`；用户、凭据、会话、成绩表不保存明文秘密或逐步日志。
- [x] `POST /api/login`、`POST /api/logout`、`GET /api/me`；Cookie HttpOnly/SameSite/7 天，生产 Secure；写接口 Origin 校验和登录限流。
- [x] `POST /api/results` 检查 `startedByUserId` 与会话相同、规则/N/统计/UTC 完成时间；复算分数、首次生成 receivedAt；重复提交内容相同返回原结果、不同返回 409。
- [x] `GET /api/history?page=1` 和 `GET /api/bests` 仅查当前用户；按 completedAt 倒序稳定分页，未舍入分数比较，按 N 分组。
- [x] CLI 创建用户、生成/换发/吊销凭据；验证旧 Token 拒绝新登录、全部旧会话失效、新 Token 历史保留、数据库重开后记录仍在。
- [x] 验证请求隔离、身份切换、并发重试、客户端分数不能覆盖、上午完成下午上传的排序；聚焦测试及 checkpoint。

### Task 3: 完整响应式训练界面

**Files:** `index.html`, `src/client/main.tsx`, `src/client/App.tsx`, `src/client/api.ts`, `src/client/styles.css`。

**Acceptance:** 简体中文浅色工具风格，合集入口、玩法/难度、游客/登录训练、结果保存状态、私人历史与最佳在桌面和手机可操作。

- [x] 实现入口、N-back 卡片、说明和难度选择；无外部图片/字体依赖，使用系统字体及清晰聚焦状态。
- [x] 接入游戏引擎与 pointer/空格统一输入；页面隐藏、卸载或离开游戏页立即作废，清理监听和计时器。
- [x] Token 登录对话框仅内存保存输入；登录对局开局调用 me 固定用户；游客结果永不上传。
- [x] 结果页展示四类统计、分数；保存中/成功/失败和手动重试，原 payload 全程不变，重新登录原用户可重试。
- [x] 个人记录页分页及各 N 最佳，切账户清空旧用户记录；浏览器构建与类型检查通过后 checkpoint。

### Task 4: 浏览器验收与产品打磨（已完成）

**Files:** `playwright.config.ts`, `tests/e2e/app.spec.ts`, `scripts/e2e-setup.ts`, `scripts/check-native-visibility.mjs`。

**Acceptance:** 真实浏览器证明桌面/手机完整流程、空格和触屏、游客不上传、中断作废、保存失败及跨标签页重试。

- [x] Playwright 启动独立临时数据库与服务；先运行用户流程以捕获尚未接入或不满足的行为，必要时修复同一范围实现。
- [x] 用浏览器 clock 控制完整 80 秒对局；验证 30 次结果、空格不滚动、手机宽度不溢出；记录桌面/手机截图。
- [x] 网络路由仅隔离失败边界：首次请求失败可手动重试；响应丢失重试只一条；页面刷新不补传；身份过期后原用户重登可重试。
- [x] 两个标签页共享 Cookie：A 待上传时另一页登录 B，保存拒绝；原结果页重登 A 后仅保存一次。
- [x] 运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`，读取结果并 checkpoint。

### Task 5: 部署、Wiki 与收尾

**Files:** `Dockerfile`, `compose.yaml`, `.dockerignore`, `.env.example`, `README.md`, `docs/wiki/architecture.md`, `docs/wiki/n-back.md`, `docs/wiki/operations.md`, `docs/verification/braingym-mvp.md`。

**Acceptance:** 本地、Docker 单服务启动，数据卷持久化，CLI 可用；文档与实际运行一致。

- [x] 多阶段构建运行非 root Node 服务，暴露 3000，SQLite 放数据卷；生产 HTTPS/Cookie 配置清晰。
- [x] Docker 构建与 health/API 冒烟；重建后验证原 Token 登录及成绩仍在；环境不可用时记录原始限制，保持未验收状态，不伪称 complete。
- [x] 调用 wiki/write-doc 同步当前架构、游戏规则、启动/运维事实；首行摘要和源码链接齐全。
- [x] 逐项记录 spec 验收证据与限制，更新本计划 checkbox；执行 git-workflow finalize 并报告实际状态，不处理任务外文件。

## 验证记录

工具链检查：本机 Node v26.12.0，内置 `node:sqlite` 可用；获准后从官方 registry 安装依赖。Docker daemon 29.8.0 可访问，Node 24 镜像构建与持久化验证均通过。

规则 RED：9/9 因桩行为不满足断言失败；GREEN：9/9 通过。服务端 RED：6 个 API 场景因 501 失败；GREEN：API 与 CLI 合计 7 个场景通过，完整 npm test 为 16/16。typecheck/build 已通过。浏览器首轮暴露选择器、辅助时钟和强制前台设置的验证问题，现已使用精确定位、受控时钟和原生 CDP 事件完成验证。Task 1–3 checkpoint：验证通过，按继承决策跳过自动提交。

最终验证：npm test 18/18，typecheck/build 通过；npm run test:e2e 7/7（含触屏 tap、HTTP 503、跨标签页与原生后台事件）通过。scripts/verify-docker.ps1 对最终镜像的静态页面、CLI、登录、评分、删容器重建后数据和幂等时间检查通过。增加未舍入最佳与 20+1 稳定分页覆盖。Task 4–5 checkpoint 验证通过，按继承决策跳过自动提交。Wiki 经独立优化与复核，PORT/APP_ORIGIN 条件已修正并复核通过。最终结果与实机覆盖边界见 docs/verification/braingym-mvp.md。

首版 Git 收尾：用户随后明确要求“提交推送第一版”，本次授权覆盖提交并推送当前 `main` 到 `origin/main`；沿用现有工作树，不创建 PR，不设置长期自动提交或推送偏好。运行数据与凭据继续排除在版本控制之外。
