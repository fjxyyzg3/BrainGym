# Stroop Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加完整的四色 Stroop 训练、可选热身、私人历史与最佳。

**Scope Source:** [已批准 spec](../../scope/2026-11-14-stroop.md)

**Architecture:** 独立内存引擎以 DOM 回执驱动单调时钟，前后端共享规则及指标。新增 SQLite 附加表，复用现有认证、成绩 API、PWA 与发布流程。

**Tech Stack:** TypeScript strict、React 19、Fastify 5、Node SQLite、Playwright；不新增依赖。

**Verification:** `npm run typecheck` → `npm run build` → `npm test` → `npm run test:e2e` → 同一构建的 `/braingym/` 浏览器测试；最后隔离演练及正式发布验收。

---

### Task 1: 规则、引擎、存储及跨游戏合同（in_progress）

**Files:** 新建 `src/shared/stroop.ts`、`src/client/stroop-game.ts`、`src/server/stroop-store.ts`、`tests/stroop.test.ts`、`tests/stroop-server.test.ts`；修改 `src/shared/contracts.ts`、`src/server/store.ts`、`scripts/release/files.ts`。

**Acceptance:** 正式 10/30、热身 2/6；首回执计时、期限上超时、反馈提交后持续 300 ms；分类指标和空值正确；会话隔离、跨表幂等、升级及指纹保留。

- [ ] RED：先向真实 Fastify fixture POST `game=stroop` 与合法 10/30 摘要，断言 200、score=75；现状应因未知游戏返回 400。测试仅导入已有 Store/app，避免模块缺失代替行为失败。
- [ ] 写规则／引擎边界测试：受控随机源校验配额和词色；输入在 2999/3000 ms；回执重复不重置；反馈未提交不跳题；末题结算后 abort 不撤销结果。
- [ ] 实现 `generateStroopTrials`、`validateStroopSummary`、`stroopMetrics`；引擎 `commit/tick/answer/abort/result`，正确毫秒舍入后累计，末题记录单调完成时刻。
- [ ] 添加专属合同、规范化解析、Repository；Store 在三表事务检查 ID，按准确率及正确耗时排序，附加表初始化可回滚。发布指纹按用户／结果 ID 保护新表。
- [ ] GREEN：`node --import tsx --test tests/stroop.test.ts tests/stroop-server.test.ts`；同时回归 `tests/corsi-server.test.ts`、`tests/server.test.ts`。
- [ ] 本单元代码 checkpoint 延后至 Task 4 全部门槛通过，避免违反仓库提交前验证约束。

### Task 2: 训练与记录界面

**Files:** 新建 `src/client/StroopTraining.tsx`、`StroopRecords.tsx`、`StroopSummary.tsx`、`tests/e2e/stroop.spec.ts`；修改 `src/client/App.tsx`、`styles.css`。

**Acceptance:** 大厅和 hash 入口可达；四个固定原生按钮；可选热身不写入，正式开局重新验证归属；错误反馈、重试、私人记录及结果导航可用，当前页面保存失败数据不持久化。

- [ ] 先写浏览器入口测试，当前页面断言“颜色干扰 · Stroop”失败；保留真实构建、服务和 DOM，时钟仅使用 Playwright 的平台替换。
- [ ] 实现训练组件生命周期、任务取消、单次结果冻结与保存；题面／反馈 `useLayoutEffect` 回执；指针及原生键盘激活绑定题目标识，拒绝跨题迟到和重复激活。visibilitychange/pagehide 作废未完成局，兼容 visibility-state 时间线及不支持浏览器的事件回退。
- [ ] 新增可复用分类汇总与私人记录组件，复用现有样式；固定按钮两列排列，四种刺激在深色题面保持可读对比，实测 320/390/768/1440 宽度。
- [ ] 接入 App 的 Page、trainingPage、记录分派和大厅；保留既有游戏专属类型与记录默认模式。
- [ ] 浏览器覆盖热身／游客不补传、全对／错／超时、身份冲突、响应丢失幂等、离开作废、触屏和原生键盘、无专用快捷键；保存截图作视觉证据。
- [ ] 本单元代码 checkpoint 仍延后至完整门槛通过。

### Task 3: 文档与验收证据

**Files:** 新建 `docs/wiki/stroop.md`、`docs/verification/stroop.md`；更新 `README.md`、`docs/wiki/architecture.md`；按需要扩展既有原生 CDP 后台验证脚本（实际路径从运维证据确认）。

- [ ] 将已实现的规则、分类摘要、DOM 时间边界、账号／游客、幂等和升级机制同步 Wiki；首行摘要并附源码／spec 来源，不写未实现状态。
- [ ] 验证既有 N-back、Corsi 不回归；隔离临时 SQLite 测试升级、旧程序忽略附加表、再次升级和指纹差异拒绝。
- [ ] 原生 Chromium CDP 验证隐藏期间未完成局作废、末题已冻结结果保留；锁屏无法自动控制时如实记录实际覆盖，不宣称已做真实硬件锁屏。

### Task 4: 必需验证、安全审查与代码 Git finalize

- [ ] 顺序执行 typecheck、build、Node 测试、根路径 E2E；随后设置 `E2E_BASE_PATH=/braingym/` 测同一构建并清除环境变量。失败先定位测试／实现／环境原因，不削弱验收。
- [ ] 检查 status、stat、全部 diff 和文件列表；按认证／会话、数据访问、浏览器暴露、部署、凭据文档、依赖及测试输出中文 Findings、Verification、Residual Risk；扫描新增内容敏感数据和打包输入。
- [ ] 更新计划及逐项验收证据；git-workflow checkpoint 提交已验证代码。finalize 刷新／rebase、push 验 SHA，干净 main 自动合入再 push，按偏好清理任务分支／worktree；不创建 PR。

### Task 5: 稳定 main 演练与正式发布

- [ ] 从主工作区稳定 main 重新建立 Git 上下文，执行 `npm run rehearse`，记录候选绑定的源码及双路径、Vite、真实隔离 Hub 验证。
- [ ] `npm run release -- deploy --candidate <实际候选目录>`，不改变 Hub 定义和网络边界；按现有工具备份完整数据库目录，失败恢复程序／运行状态，不回滚数据库。
- [ ] 核对 release status、Monitor／Forwarding、真实 HTTPS 页面及资源、匿名私人接口拒绝和既有数据指纹；正式库只读，不创建测试账号。
- [ ] 记录并提交正式验收文档，git-workflow finalize；只有必需证据完整时报告整体完成，否则明确实际阻塞与已完成部分。
