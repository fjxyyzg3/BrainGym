# 规则切换 Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付独立数字规则切换训练、私人汇总记录及可验证的正式发布。

**Scope Source:** [已批准 spec](../../scope/2026-11-16-task-switching.md)

**Architecture:** 新增共享规则、独立回执驱动的内存引擎、React 训练／汇总／记录组件及 SQLite 附加仓储。现有 API 负责会话授权和五表统一幂等，发布指纹保护新表；其他游戏保持原有语义。

**Tech Stack:** Node.js 24、TypeScript strict／ESM、React 19、Vite 7、Fastify 5、node:sqlite；不新增依赖。

**Verification:** Node 规则／引擎／API／数据保护测试，Playwright 双路径浏览器测试，原生 CDP 后台验证、渲染检查及既有演练／发布验收。代码提交前依次执行 typecheck、build、test、test:e2e。

---

### Task 1: 固化保存与隐私的可观察 RED

**Files:** Create `tests/task-switching-server.test.ts`。

**Acceptance:** 当前 API 缺少新模式时，完整正式摘要保存测试得到 400 而非期望 200，形成真实缺失行为证据；测试使用独立临时 SQLite。

- [x] 构造真实 Store／Fastify fixture，建立隔离用户及会话，提交 `game=task-switching`、两组各 20 题的合法摘要；断言服务端返回复算的准确率、正确均值和切换差。
- [x] 执行 `node --import tsx --test tests/task-switching-server.test.ts`，记录预期断言失败，排除导入、语法和环境错误。

合并适配：准备 finalize 时发现 main 已新增并发布心理旋转。保留其全部实现，新模式接入五张成绩表的统一幂等与数据指纹，并扩充两模式间双向冲突测试；批准 spec 中的四表描述是当时仓库基线。本次整合后重新运行完整验证，旧的 134／83 项证据只证明整合前代码。整合后的 typecheck、build、146 项 Node 与双路径各 94 项 E2E 已全部通过。

补充验证：独立文稿复核发现整体次数缺失，真实 React 渲染测试先 RED，补齐共享汇总／结果行后 GREEN。整合前代码 typecheck、build、134 项 Node、双路径各 83 项 E2E 通过；原生 CDP 三相位通过，最终末题状态再次复验通过。

RED 证据：`node --import tsx --test tests/task-switching-server.test.ts` 实际返回 400／INVALID_RESULT，合法摘要测试期望 200，断言失败而非环境或导入错误。

### Task 2: 共享合同、引擎与存储

**Files:** Create `src/shared/task-switching.ts`、`src/client/task-switching-game.ts`、`src/server/task-switching-store.ts`、`tests/task-switching.test.ts`；Modify `src/shared/contracts.ts`、`src/server/store.ts`、`scripts/release/files.ts`、`tests/task-switching-server.test.ts`。

**Acceptance:** 起始题排除、相邻规则分类、固定配额、单调回执和终局冻结成立；真实 API 完成五表幂等、会话隔离、校验和数据保留。

- [x] 新增 `TASK_SWITCHING_GAME`、专属摘要／指标／请求／保存结果／历史类型，公共 union 纳入新模式；既有类型含义不变。
- [x] 实现 `generateTaskSwitchingTrials`、`taskSwitchingAnswer`、`validateTaskSwitchingSummary`、分类及整体指标；测试 41／9 题、20／4 配额、候选、零正确、负差和非法摘要。
- [x] 实现 `TaskSwitchingGame.tick/commit/answer/abort/result`：题面和反馈回执独立，首题不累计，期限相等超时，首次输入后关闭，末题冻结；测试重复／旧回执、迟到调度、时钟倒退、中断和末题后台。
- [x] 新仓储规范化请求并原子建立 `task_switching_results`；Store 的 parse/save/history/bests 分派接入新类型，保存事务在所有成绩表拒绝同用户同 ID 的不同内容。
- [x] 扩展 API 测试：分类校验、客户端伪造分数复算、重试和键序、四类旧游戏双向冲突、匿名／跨账号／过期／撤销、稳定最佳、分页及超大请求。
- [x] 扩展可选表指纹和隔离测试：无表旧库兼容、空表丢失、行删除／修改、重复／失败初始化、旧程序打开后再升级均不丢数据。
- [x] 重跑 Task 1 同一命令达到 GREEN；执行 `node --import tsx --test tests/task-switching.test.ts tests/task-switching-server.test.ts`。
- [x] 本任务先保留未提交代码，按仓库门槛在 Task 4 的完整验证通过后统一 checkpoint，避免提交未通过必需检查的中间状态。

### Task 3: 训练、结果、记录与交互

**Files:** Create `src/client/TaskSwitchingTraining.tsx`、`TaskSwitchingSummary.tsx`、`TaskSwitchingRecords.tsx`、`tests/e2e/task-switching.spec.ts`；Modify `src/client/App.tsx`、`src/client/styles.css`、`scripts/check-native-visibility.mjs`。

**Acceptance:** 大厅／hash／记录跳转正确；正式、热身、游客和账号流程完整；F/J、原生按钮、指针与触屏只接受当前题的新操作，完成结果不补传或持久化。

- [x] 先写新模式入口及正式完整结果浏览器测试，再扩充热身、错误／超时、计数和快捷键覆盖；真实页面和真实服务器组成验证边界，不 mock 训练引擎。
- [x] 参考现有 Stroop 的身份、回执、网络和中断实现新增独立组件；规则、数字及按钮文字同次提交，起始题明确标识，正式进度只显示 40 道计分题。
- [x] 为 F/J 注册仅运行时有效的输入入口；拒绝 modifiers、输入控件、组合输入和 repeat；指针及原生键盘绑定呈现标识，释放或迟到事件不能替下一题回答。
- [x] 接入大厅卡片、页面标题、hash、公共游戏筛选与结果进入记录；记录切换账号／模式时使旧任务失效，普通入口仍默认空间模式。
- [x] 新增与现有视觉系统一致的样式；原生按钮并排、44 px 以上触控高度、可见焦点，反馈和汇总使用语义化文字与表格。
- [x] 覆盖账号保存、失败／响应丢失重试、跨标签页身份变化、离开／后台／完成边界；游客／热身永不调用保存接口，重载不恢复待上传数据。
- [x] PWA 已缓存离线场景进入新模式并完成游客局；扩展原生后台脚本支持起始题／反馈／完成，实际 CDP 切标签页验证，记录硬件锁屏和实体手机未覆盖的限制。

### Task 4: 完整验证、Wiki 与代码交付

**Files:** Create `docs/wiki/task-switching.md`、`docs/verification/task-switching.md`；Modify `README.md`、`docs/wiki/architecture.md`、本 plan 及本任务实际代码／测试。

**Acceptance:** spec 验收均有证据或明确实际限制，必需自动验证通过；代码和文档均经过安全审查后按偏好合入 main。

- [x] 顺序执行 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`；再设置 `E2E_BASE_PATH=/braingym/` 对同一构建运行 E2E 并清除变量。构建与运行测试不并行。
- [x] 执行原生后台和桌面／窄屏截图检查，检查左右映射、焦点、文字、横向溢出；所有服务与手动验证显式使用隔离数据库。
- [x] 使用 wiki 工作流同步已验证事实；README 概览、架构类型与数据保护范围同步；验证文档记录 RED/GREEN、实际命令、结果和限制。
- [x] 审查 status、stat、实际 diff、文件列表；覆盖授权、参数校验、跨表事务、浏览器持久化、网络／打包输入、凭据文档及依赖不变，输出中文 Findings／Verification／Residual Risk。
- [x] 调用 git-workflow checkpoint/finalize：只 stage 本任务文件，按偏好刷新／rebase、提交、push 并核对实际远端；主树干净才合入 main，再推送、核对并清理已合并干净分支／worktree。

### Task 5: 演练和正式发布

**Files:** `docs/verification/task-switching.md`，私有演练／发布产物仅放忽略目录。

**Acceptance:** 稳定 main 的已验证候选完成正式发布，既有数据保留，真实入口的新模式可用。

- [x] 从稳定 main 重新建立 Git 上下文，读现役运维和发布入口；执行 `npm run rehearse`，检查候选与当前 main、Node、锁文件和运行产物证据一致。
- [x] 显式使用该候选执行既有 release deploy，按 appId Stop/Start，定义不变不 Reload；遵守停服后完整目录备份及恢复责任。
- [x] 检查 release status、健康、数据指纹、程序摘要及真实 HTTPS 入口；匿名练习不创建正式测试身份或成绩，真实值只留私有材料。
- [ ] 回写脱敏验证结果，执行文档安全审查与 git-workflow finalize；记录最终提交、远端 SHA、清理及剩余风险后报告整体结果。
