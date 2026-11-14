# Corsi Block Memory Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加正倒序 Corsi 逐级挑战、私人记录、自适应起点与安全恢复。

**Scope Source:** [已批准 spec](../../scope/2026-11-14-corsi-blocks.md)，用户于 2026-11-14 明确批准并要求实施。

**Architecture:** Corsi 独立引擎与共享规则；现有成绩 API 按游戏族分派，附加成绩及世代表保持核心 schema 1 向后兼容。React 新训练／记录组件接入现有导航、身份及 PWA，账号进度按世代内最近有效完成局推导。

**Tech Stack:** Node 24、TypeScript strict、React 19、Fastify 5、node:sqlite、Playwright，不新增依赖。

**Verification:** 聚焦规则／引擎／HTTP 测试先 RED 后 GREEN；最终依次 typecheck、build、test、test:e2e，再同构建前缀路径 test:e2e；真实原生浏览器后台验证、隔离演练、正式发布与数据保留核验。

---

## 执行约束

- Git 上下文继承 `feature/corsi-blocks` 与 `.worktree/feature/corsi-blocks`，基线 `eaa686a`；原始工作区无任务外修改。获批 spec 已单独 checkpoint 为 `b0eba74`。
- 本计划是实施安排，不再请求计划批准。spec 是唯一契约，不改变无限玩法长度、两题升级、首题失败优先降级等规则。
- 源码步骤是同一完整功能的连续工作单元。聚焦测试用于迭代；按 AGENTS.md，所有运行代码在完整四项门槛通过前不 checkpoint，避免提交类型尚未闭合或未全量验证的中间状态。
- 构建与运行时测试串行；浏览器、CLI、旧库兼容及脚本验证均使用明确的隔离 SQLite，不接触正式库做测试。生产身份、入口和凭据不进入跟踪文件。

## Task 1：共享合同、规则与独立状态机

**Files:** 修改 `src/shared/contracts.ts`、`src/client/game.ts` 的 N-back 类型边界；新增 `src/shared/corsi.ts`、`src/client/corsi-game.ts`、`tests/corsi.test.ts`。

**Acceptance:** 正倒序索引正确；每级两题；四个 spec 起点例子成立；0 格未通过；长度跨过 9；准备可取消、每批至多 256 步；漏交付／101 ms 延迟作废，100 ms 允许。

- [ ] RED：在 `tests/corsi.test.ts` 通过公开规则／引擎行为构造断言。先运行 `node --import tsx --test tests/corsi.test.ts`，确认失败源于 Corsi 标识／能力缺失；不接受语法或 fixture 错误作为 RED。
- [ ] GREEN：区分 `NBackGameId` 与公共 `GameId`，保留旧结果别名并新增公共结果联合；共享 Corsi 摘要校验与 `score/nextStartLength` 推导，规则版本 1。
- [ ] GREEN：按需分批生成无相邻重复序列，同级第二题与首题不同；取消和资源错误不产生结果。引擎拥有序列、输入、反馈与最终摘要；视图回执只是有效展示的运行机制，不增加测试专用状态入口。
- [ ] GREEN：实现准备、展示、复现、反馈、结束、作废；首题对仍做第二题，完整序列后整体判定，记不住计一次失败；保持已完成结果不受后来 abort 影响。
- [ ] 聚焦回归：运行本任务测试及 `tests/game.test.ts`、`tests/color-n-back.test.ts`、`tests/triple-n-back.test.ts`。记录 RED/GREEN 与取消／边界信号；源码 checkpoint 延后至 Task 4 门槛通过。

## Task 2：附加存储、授权接口与发布数据保护

**Files:** 新增 `src/server/corsi-store.ts`、`tests/corsi-server.test.ts`；修改 `src/server/store.ts`、`src/server/app.ts`、`scripts/release/files.ts` 及 `tests/release-artifact.test.ts`。

**Acceptance:** 两方向、用户及世代隔离；时间锚点返回；新结果未来 5000 ms 允许、5001 ms 拒绝；旧异常时间不重新生效；恢复保留历史／最佳、旧局不改新世代进度；跨表 ID 冲突及旧 N-back 重试兼容。

- [ ] RED：先以真实临时 Store／Fastify inject 调用 Corsi progress，断言匿名 401、登录用户首次为 2；现有版本无接口应产生预期不符的失败。扩展合法／非法摘要、首次入库时间、两方向历史及最佳断言。
- [ ] GREEN：附加 `corsi_results`、`corsi_progress_resets` 原子幂等初始化，核心 user_version 仍为 1；保存分派复用事务和身份前置校验，旧规范化顺序不变，跨两成绩表检查 ID。
- [ ] GREEN：实现 progress 的用户／serverNow／世代／起点／最佳；按完成时间选世代内最近有效结果，既有未来异常记录对 immutable receivedAt 判定并在历史标记。
- [ ] GREEN：实现 reset 的会话／Origin／expectedUserId／expectedEpoch 校验与事务递增，重复旧世代请求返回 409。旧世代成绩保留历史与最佳，未知未来世代拒绝；幂等查重先于新结果时间检查。
- [ ] 回归：服务端测试覆盖匿名、过期／吊销会话、换账号、越权重置、响应丢失式重试、旧局迟到和序列摘要大小不随格数增长。指纹检查同时保护附加表存在性及行数据。
- [ ] 兼容：在临时目录物化基线 `eaa686a` 的 Store、规则、合同与错误模块，用真实旧版入口重新打开含两张附加表的隔离库，再用新版打开，验证新旧数据及世代保留；不以当前实现冒充旧版。运行 `node --import tsx --test tests/corsi-server.test.ts tests/server.test.ts tests/release-artifact.test.ts`；checkpoint 延后。

## Task 3：前端完整体验与浏览器证据

**Files:** 新增 `src/client/CorsiTraining.tsx`、`src/client/CorsiRecords.tsx`、`tests/e2e/corsi.spec.ts`；修改 `src/client/App.tsx`、`src/client/styles.css`、`scripts/check-native-visibility.mjs` 及相关 PWA 浏览器测试。

**Acceptance:** 单张大厅卡片、正倒序 hash；鼠标／触屏／数字键复现；当前页游客进度；登录起点跨设备；资源恢复及漏展示不罚分；旧模式显示和身份边界保持。

- [ ] RED：先写大厅 Corsi 卡片与准备页浏览器断言，并在既有构建上执行 `npx playwright test tests/e2e/corsi.spec.ts --grep '入口'`，确认缺卡片造成失败，不以页面／服务故障作为 RED。
- [ ] GREEN：新训练组件接入 owner、方向、起始长度、世代、serverNow＋performance.now 锚点；异步准备可取消，useLayoutEffect 反馈相位提交，rAF 检测超限后先 abort 再处理输入。
- [ ] GREEN：九个原生按钮编号 1～9，只用 click 计步，数字键忽略 repeat／修饰键／输入框；所有阶段有中文说明，反馈不依赖颜色。复现只显示输入数量；题间手动继续；保存与进度刷新失败分开处理。
- [ ] GREEN：恢复使用原生 dialog.showModal，取消为默认安全动作；确认携带预期用户／世代，网络未知先重查，不盲目再次 POST。序列准备使用 scheduler.yield 特性检测及 setTimeout 回退；不新增 polyfill／依赖。
- [ ] GREEN：公共导航接入两 hash，Records 按游戏族选择专用渲染；Corsi 历史与最佳使用格数，结果返回正确方向，旧请求失效；游客内存进度由 App 文档生命周期持有，刷新归零。
- [ ] 浏览器回归：真实可见刺激驱动正序／倒序；完整结束、不给逐步提示、记不住、按键去重、移动触屏、方向／账号切换、保存失败／重试、重置竞争、旧结果迟到、墙上时钟修改、前台阻塞作废、离线游客及刷新重置。测试不向生产组件注入答案接口。
- [ ] 原生后台：扩展既有 CDP 脚本覆盖 Corsi 的展示／复现／反馈；使用专用数据库及账号。保存桌面／移动准备、训练、结果与记录截图，标明模拟视口和实际硬件覆盖差异；checkpoint 延后。

## Task 4：全量验证、知识与代码 checkpoint

**Files:** 新建 `docs/wiki/corsi.md`、`docs/verification/corsi-blocks.md`；更新 `README.md`、`docs/wiki/architecture.md`、`docs/wiki/operations.md`、本 plan。

- [ ] 调用 wiki 同步实际规则、时间／世代合同、资源恢复、数据兼容与运维边界，验收记录只写真实证据，区分模拟及实机未验证。
- [ ] 依次执行 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`；同一构建设置 `E2E_BASE_PATH=/braingym/` 再执行浏览器测试，finally 清除变量。失败修实现或环境，不削弱门槛。
- [ ] 按最终 status、stat、文件列表和 diff 执行中文 Findings／Verification／Residual Risk 安全审查。未改依赖则不新增无必要的 audit；若依赖实际变化，执行 npm audit --json 并评估。
- [ ] 所有必需代码门槛通过后按 git-workflow checkpoint 只提交任务文件；记录 hash。通过的最终证据可复用，不为提交重复全量测试。
- [ ] 执行 `npm run rehearse` 准备真实隔离候选并记录证据；若运行源码改变则重新生成候选。提交必要的验收文档，finalize 刷新／rebase／push，main 干净时合入并 push，核对实际远端 SHA，按偏好清理任务分支及 worktree。

## Task 5：稳定 main 正式发布与整体验收

- [ ] 从稳定 main 重新调用 git-workflow prepare；按运维文档核对私有现役定义、候选与运行源码一致性、正式数据保留和真实入口，凭据不输出到日志／聊天／跟踪文件。
- [ ] 显式 `npm run release -- deploy --candidate $releaseCandidate`，不变定义不 Reload，保留 Stop 请求起的恢复责任；失败只恢复程序／本次定义，不回滚数据库。
- [ ] `npm run release -- status` 及真实 HTTPS 静态入口／资源／安全头／Cookie／API 拒绝边界验收；正式库不创建测试身份或成绩。读取部署数据保留证据确认旧数据及新表元数据保持。
- [ ] 记录正式结果；只有正式验收完成才报告整体完成。如环境或权限阻塞，记录具体证据并按真实结果 finalize，不把未执行项记为通过。

## 执行记录

- 2026-11-14：用户批准 spec，文档检查通过，设计基线 checkpoint `b0eba74`。继承现有 prepared Git 生命周期，主工作区 main 仅前进了一份无运行影响的既有验收文档。
