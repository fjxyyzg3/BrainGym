# Mental Rotation Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现可离线游客练习、账号分类记录与最佳的二维心理旋转。

**Scope Source:** [已批准 spec](../../scope/2026-11-16-mental-rotation.md)

**Architecture:** 共享模块定义整数格几何、出题配额与分类指标；独立浏览器引擎拥有回执、首次回答及完成边界。React 使用同一几何事实生成 SVG，API 沿用会话授权并将规范化摘要写入独立附加表，四表统一查重。

**Tech Stack:** TypeScript strict / ESM、React、Vite、Fastify、Node SQLite；不新增依赖。

**Verification:** 聚焦 Node／浏览器测试；按顺序运行 typecheck、build、Node 全量、根路径 E2E、同一构建前缀 E2E；原生 Chromium CDP、布局截图、PWA；演练及正式发布。

---

## Git 与文件所有权

- 继承 `prepared`：基线 main／origin/main 为 `0d8cad7`，起始无修改；分支 `feat-mental-rotation`，worktree `.worktree/feat-mental-rotation`。
- spec checkpoint：`7db2c70 docs: approve mental rotation specification`。本计划单独检查并 checkpoint；运行代码在完整提交前门槛全部通过后统一 checkpoint，不用局部测试代替仓库要求。
- 只暂存本任务文件，不创建 PR。按偏好同步、push、main 干净时合入并 push；成功后清理任务分支和 worktree。正式发布从稳定 main 重新 prepare，候选与运行源码一致后部署。

### Task 1: 基线与共享几何、规则

**Files:** `tests/mental-rotation-server.test.ts`；新增 `src/shared/rotation-geometry.ts`、`rotation-shapes.ts`、`mental-rotation.ts`，扩展 `src/shared/contracts.ts`；新增 `tests/mental-rotation.test.ts`。

**Acceptance:** 正式 16 种分类各 2 题；热身覆盖分类；随机退化仍有限完成合法、不重复形状。几何与 SVG 路径一致；摘要拒绝非法或溢出数据。

- [ ] 安装锁定依赖，使用临时 SQLite 和既有 `buildApp` 写 API 测试：POST 新游戏完整摘要，断言 200 及复算指标；运行 `node --import tsx --test --test-name-pattern="accepts complete mental rotation" tests/mental-rotation-server.test.ts`，确认现有 API 的 400 是预期 RED。
- [ ] 定义 `RotationComplexity`、`RotationAngle`、`RotationRelation`、`RotationGroup`、`RotationSummary`、结果／历史类型和 `ROTATION_GAME`。`groups` 为带分类键的 16 项数组，每组正确加错误为 2，耗时及总和必须是非负安全整数。
- [ ] 实现整数格归一、D4 等价键、连通／孔洞／旋转与反射对称检测、外轮廓路径和两图共同 viewBox。随机增长与拒绝有界，备用每类至少 16 个，经过同一验证并参与去重。
- [ ] 实现 `generateRotationTrials`、摘要校验／规范化和 `rotationMetrics`；热身使用 8 题，分别覆盖角度、复杂度和关系，实际配额用于本地统计。
- [ ] 规则测试独立检查变换、面积、轮廓等价、形状合法性、配额、恒定随机源补齐、非法随机源、长耗时与溢出、零正确及加权指标；运行 `node --import tsx --test tests/mental-rotation.test.ts`。

### Task 2: 独立内存引擎

**Files:** 新增 `src/client/mental-rotation-game.ts`，扩展 `tests/mental-rotation.test.ts`。

**Acceptance:** 未提交不计时、不限时、仅首次回答、反馈回执后 800 ms 推进；末题先冻结完整结果，未完成中断作废。

- [ ] 实现 `MentalRotationGame` 的 `tick`、`commit`、`answer`、`abort`、`result`；快照包含相位、题号、交付 ID、是否提交、当前题和反馈。单调时钟非法或倒退时作废未完成局。
- [ ] 测试重复／旧回执、长时间思考、回答去重、错误题不贡献正确耗时、799／800 ms 边界、迟到 tick 不跳题、结果防外部修改、末题反馈与中断；运行聚焦测试并记录结果。

### Task 3: API、附加存储和发布数据保护

**Files:** 新增 `src/server/mental-rotation-store.ts`，修改 `src/server/store.ts`、`scripts/release/files.ts`，扩展 `tests/mental-rotation-server.test.ts`。

**Acceptance:** 初始 API RED 转 GREEN；身份、四表幂等、统计复算、最佳／历史、升级及恢复保留符合 spec。

- [ ] 原子、可重复追加 `mental_rotation_results` 及索引；规范化解析分类顺序、UTC 与 ID。存储以会话用户限定，先比较准确率，再比较正确耗时总和及稳定次序。
- [ ] 扩展公共分派与四表双向冲突检查，保持旧 payload 规范化及默认空间查询；发布指纹识别可选新表、存在性及行。
- [ ] 原 API 命令转 GREEN；补匿名、跨账号、过期／撤销、Origin、请求体、非法摘要／总耗时溢出、键及分类重排、响应时间不变、三种旧游戏双向冲突、分页与同分最佳测试。
- [ ] 隔离 SQLite 检查重复初始化、初始化失败回滚、旧 Store 打开／再次升级及指纹拒绝删除／改写；运行 `node --import tsx --test tests/mental-rotation.test.ts tests/mental-rotation-server.test.ts`。

### Task 4: 训练、结果、记录及离线界面

**Files:** 新增 `src/client/MentalRotationTraining.tsx`、`RotationFigure.tsx`、`RotationSummary.tsx`、`MentalRotationRecords.tsx`；修改 `src/client/App.tsx`、`styles.css`；新增 `tests/e2e/mental-rotation.spec.ts`，按需扩展 `tests/e2e/pwa.spec.ts`。

**Acceptance:** 大厅／hash／标题／筛选一致，32 题和热身可操作，静态 SVG 同尺度，首次输入与身份边界可靠，离线游客不补传。

- [ ] 用当前构建运行新卡片数量断言，确认 UI 尚缺入口的 RED；先读既有 Stroop 组件及测试反模式，再复用其开局／保存生命周期的结构，不复制其限时或题型规则。
- [ ] SVG 只暴露参考图／待判断图名称；题目快照保留至反馈结束。按钮固定顺序，原生激活绑定开始时交付 ID，反馈和长按不污染下一题，焦点可见。
- [ ] 账号开始前核对 `/me`；生成与异步回调按任务取消；末题生成原始固定 payload 自动保存一次，失败当前页手动重试，游客／热身不保存。监听原生隐藏和 pagehide，中断未完成局。
- [ ] 接入整体、角度、复杂度统计及整局最佳／20 条历史；旧账号／模式请求失效；普通记录仍默认空间模式。
- [ ] 浏览器覆盖正确／错误、长思考、800 ms、热身、游客、登录后不补传、账号保存／响应丢失重试、换账号拒绝、刷新丢弃、指针及键盘长按、移动端触摸、离线缓存及双路径导航。

### Task 5: 全面验收与知识同步

**Files:** `scripts/check-native-visibility.mjs`；新增 `docs/wiki/mental-rotation.md`、`docs/verification/mental-rotation.md`；更新 `docs/wiki/architecture.md`、`README.md`、本计划。

**Acceptance:** spec 所有本地验收有实际证据，文档与最终代码一致，无凭据和任务外文件进入提交。

- [ ] 顺序运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`，同一构建设置 `E2E_BASE_PATH=/braingym/` 再跑 E2E，随后清除变量；失败修复后按失效范围补跑，不并行构建与测试。
- [ ] 原生 CDP 在独立库验证 question／feedback／complete 后台边界；检查 320、390、768、1440 宽度、触控、键盘、缩放及 SVG 不裁切／同尺度，保存并查看截图。明确未验证的实体设备、硬件锁屏及像素精度。
- [ ] 调用 wiki 同步已确定目标，写真实 RED／GREEN、回归、安全 Findings／Verification／Residual Risk 与剩余风险；检查 status、stat、实际 diff、格式、链接及敏感文本，确认无新依赖。
- [ ] 按完整门槛的有效证据 checkpoint 运行代码与文档；finalize 刷新远端、同步、push 核对 SHA，main 干净时合入推送并清理。

### Task 6: 稳定 main 演练与正式发布

**Files:** 沿用 `scripts/release/`，更新稳定 main 中的 `docs/verification/mental-rotation.md`。

**Acceptance:** 已提交 main 对应的候选通过演练，正式运行与数据保留核验通过后才整体完成。

- [ ] 从稳定 main 重新 Git prepare，先读运维与既有环境验收；运行 `npm run rehearse`，核对候选源码指纹、检查项、产物及当前 main 一致。
- [ ] 显式执行 `npm run release -- deploy --candidate $releaseCandidate`，其中 `$releaseCandidate` 取上一项演练输出的 candidate 目录，随后 `npm run release -- status`；保持现有绝对数据库路径，定义不变不 Reload，失败遵循原恢复流程。
- [ ] 真实入口只做匿名心理旋转热身／游客验证并拦截写请求，不创建正式测试账号或成绩；核对既有数据指纹、静态资源、匿名私人 API、实际安全头及页面错误。
- [ ] 保存脱敏发布证据与验收结果，按纯文档检查 checkpoint／finalize，核对远端 SHA；报告变更、实际验证、剩余风险与 Git／发布状态。

## 执行证据

- 设计批准：当前对话明确要求“批准，按 spec 开始实施”；实施输入为 `approved-spec`，继承 `git_state: prepared`。
