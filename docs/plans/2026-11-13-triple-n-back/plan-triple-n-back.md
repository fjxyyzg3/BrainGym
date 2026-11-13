# 三元素 N-back Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增位置、颜色、数字三路独立判断的第三种模式，保留旧合同并完成隔离验证与正式发布。

**Scope Source:** [已批准 spec](../../scope/2026-11-13-triple-n-back.md)。

**Architecture:** 扩展共享结果联合类型、规则和 NBackGame，三种模式共用时钟、身份与保存通路。新模式保存 position/color/number 三组统计，综合分使用三路未舍入平衡准确率均值；不改数据库 schema、认证或 PWA 缓存边界。

**Tech Stack:** 现有 TypeScript、React、Vite、Fastify、node:sqlite、Node test、Playwright；不新增依赖。

**Verification:** 聚焦 Node 测试先 RED 后 GREEN；最终依次 typecheck、build、test、根路径 e2e、同一构建前缀 e2e，另做界面截图检查。已提交源码经 rehearse 后，在稳定 main 显式 deploy 与 status 验收。

---

## Git 与文件所有权

继承 prepared：主仓库 `D:/GithubRepos/BrainGym`，任务分支 `feat-triple-n-back`，worktree 为主仓库下 `.worktree/feat-triple-n-back`；起始无任务外修改，基线 main `10e709b`。已批准 spec 单独 checkpoint；本计划单独 checkpoint。产品改动作为完整跨模块工作单元，满足仓库全部验证门槛后 checkpoint，不提交中间类型不完整状态。按现有偏好同步、推送、合入、核对远端并清理。发布阶段从稳定 main 重新 prepare，候选保留于主仓库 `.runtime/releases/`。

## Task 1：规则、合同、引擎与保存

**Files:** 修改 `src/shared/contracts.ts`、`src/shared/rules.ts`、`src/client/game.ts`、`src/server/store.ts`；新增 `tests/triple-n-back.test.ts`。

**Acceptance:** 三路独立出题、输入与计分，完整校验数字一路；旧请求规范化及服务端授权不变。

- [x] RED：先新增真实 Store/Fastify 测试，以 `game: spatial-color-number-n-back` 和三路合法统计 POST，断言 200、服务端三路均分与三路内容完整；当前应因不支持新模式而返回 400。运行 `node --import tsx --test tests/triple-n-back.test.ts`，记录预期失败。
- [x] 合同：增加 `TRIPLE_GAME`、三路 Counts/ResultInput，游戏名、模式列表及维度标签统一定义；不改变旧两种结果字段。刺激增加 number＝1～9；`generateTripleSequence` 复用分路生成器，按步组合三路。
- [x] 引擎：扩展启用维度、数字刺激及已标记状态，保持单调时钟；构造时拒绝非法数字，非三路模式拒绝数字输入；结束只产生本模式统计。
- [x] 服务端：明确三种模式分派，逐路校验，固定顺序规范化新 payload；旧 payload 字段及顺序完全保留。复用 `isGameId` 扩展 API 筛选，不更改 SQL/schema。
- [x] GREEN：扩展测试覆盖所有 N、独立阈值与候选范围、八种组合、起始拒绝、留空输入、去重、跳步、完成／作废、100/0/50、三路不等分与未舍入均值、逐路非法数据、键顺序重试／任一路冲突、跨模式 ID 冲突、用户／模式／N 隔离、撤销和过期会话。运行 `node --import tsx --test tests/triple-n-back.test.ts tests/color-n-back.test.ts tests/game.test.ts tests/rules.test.ts`。
- [x] checkpoint：先不单独提交，原因是共享合同与后续页面必须一起通过 typecheck 和全套门槛；并入 Task 4 的产品 checkpoint。

## Task 2：训练与记录页面、浏览器验收

**Files:** 修改 `src/client/App.tsx`、`src/client/styles.css`、`tests/e2e/app.spec.ts`、`tests/e2e/pwa.spec.ts`、`scripts/check-native-visibility.mjs`；新增 `tests/e2e/triple-n-back.spec.ts`。

**Acceptance:** 独立入口、彩色格内数字、F/J/K 与三个按钮、三路结果／记录；旧模式仍可用。

- [x] RED：在页面实现前新增大厅第三卡片和三个按钮用例；使用当前构建运行该用例，确认缺少新入口而失败。浏览器不能运行时先修前置环境，不把启动错误当 RED。
- [x] 页面：新增 `#triple-n-back` 显式路由；由模式启用维度派生按钮和标签。保留空间空格、双路 F/J，三路 F/J/K；复用现有输入排除、repeat 与 pointer/click 去重。数字只在亮起格内渲染，留空辅助描述不泄露刺激。
- [x] 结果与记录：按本局游戏构造结果，展示综合分及启用维度的分数／四类统计；记录模式列表扩展到三种，维持结果来源选择、默认空间、分页与过期请求清理。
- [x] 样式：延续现有体系；大屏三按钮并列，窄屏允许纵向排列；最小触控区至少 44px。数字采用与现有六色均足够对比的文字颜色，已标记使用文字／图标且不显示正误。
- [x] GREEN：浏览器按可见位置、背景色和数字记录刺激并正确作答，断言三路与综合分 100、保存与模式导航正确；另覆盖留空输入、同轮三路、K 长按、游客 50 分不补传、响应丢失和跨账号重试、失效会话、慢记录响应、320/390px 无整页溢出、多点触屏三路。
- [x] 扩展原生 CDP 脚本模式路由与 e2e 调度，明确包含新模式；扩展真实 Service Worker 离线第三模式用例，观察恢复网络后零补传。
- [x] 通过截图检查准备、亮起／留空、三个按钮标记、结果、记录；保存截图到未跟踪 `test-results/`，注明实际设备未覆盖。checkpoint 并入 Task 4。

## Task 3：文档、完整验证与安全审查

**Files:** 更新 `README.md`、`docs/wiki/n-back.md`、`docs/wiki/architecture.md`；新增 `docs/verification/triple-n-back.md`，更新本计划。

**Acceptance:** 文档反映已验证的三模式行为，必要验证全部通过，证据不夸大。

- [x] 顺序运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`；设置 `$env:E2E_BASE_PATH='/braingym/'` 后再次运行 `npm run test:e2e`，结束后 `Remove-Item Env:E2E_BASE_PATH`。所有运行时测试使用隔离库，构建不与测试并行。
- [x] 对照 spec 每条验收，把命令、数量、截图观察和未覆盖设备写入验收记录；依赖未变则说明不新增 npm audit 义务。
- [x] 使用 wiki skill 同步现有两页和 README：刺激、三路输入、计分、独立记录、游戏标识与新合同；保留单／双路含义及运维机制。
- [x] 安全审查：检查 status、实际 diff、文件列表；逐项核对会话派生身份、参数绑定、逐路校验、幂等、来源和 Cookie 不变、PWA 私人数据不缓存、无外部请求／敏感信息／临时产物。输出 Findings、Verification、Residual Risk。

## Task 4：Git 交付与演练

**Files:** 本任务全部经过审查的产品、测试和文档文件；不暂存任务外文件。

- [x] 全部门槛通过后 checkpoint 完整产品工作单元，记录 commit。
- [x] 在已提交源码上运行 `npm run rehearse`，记录输出候选目录和各隔离检查结果；候选由现有工具保留在稳定主仓库，不依赖任务 worktree。
- [x] git-workflow finalize 代码阶段：刷新远端、rebase、push 并核对 SHA；main 干净时合入并 push，核对 main SHA，清理已合并的任务分支与 worktree。若运行源码因同步改变，候选失效则从 main 重新演练。

## Task 5：正式发布与收尾

**Files:** 稳定 main 的验收文档与本计划；私有候选、备份、状态仅留在未跟踪 `.runtime/releases/`。

- [x] 从稳定 main 重新调用 git-workflow prepare，确认当前源码与候选证据一致；读取现有运维与发布脚本前置条件，不输出私有入口或认证。
- [ ] 使用已验证 candidate 执行 `npm run release -- deploy --candidate $releaseCandidate`，然后 `npm run release -- status`；复用现有 Stop／备份／恢复机制，定义未变不 Reload，不写正式测试身份或成绩。
- [ ] 核对现役程序、Monitor／Forwarding、真实 HTTPS 与前缀静态资源、新模式页面及既有数据库只读指纹；失败保留恢复现场，不把健康接口单独视为发布成功。
- [ ] 记录实际发布证据与残余风险，完成计划；文档检查及安全扫描后 finalize 发布文档，自动 commit／push 并核对远端，不宣称未完成的必需验证已完成。

## 执行证据

- 2026-11-13：spec checkpoint `13e07a1`，plan checkpoint `2c5a71c`。
- RED：`node --import tsx --test tests/triple-n-back.test.ts` 得到预期 `400 !== 200`；基线 build 后新浏览器用例因第三张卡片不存在而失败。
- Task 1 GREEN：三路／双路／规则／引擎聚焦命令 27/27 通过。界面扩展后的 typecheck、build 通过；尚待浏览器与完整验收。

- 2026-11-14：修正实际六色黑／白字对比度、原空间按钮高度导致的滚动回归及合跑登录额度隔离；不削弱断言或生产限流。最终 typecheck/build 通过，Node 94/94、根路径 e2e 37/37、同一构建前缀 e2e 37/37。已查看最终准备／留空／数字／记录及 320/390px 结果截图。
- wiki/write-doc：沿用已匹配的规则页与架构页，按当前代码同步；当前 agent 完成起草、优化及复核，协作接口限制导致无独立子代理复核，未把此项伪记为独立审查。

- 产品 checkpoint：`12dc206 feat: add position color number n-back mode`。
- 候选演练：`npm run rehearse` 通过全部 8 项检查，真实隔离 Hub 证明备份失败恢复、发布失败回退、数据保留及全局 Reload 保护；候选 `12dc20652b40-c70733df-ef21-4687-982f-9a5c5c82bbf4`，存于稳定主仓库 `.runtime/releases/candidates/`。

- 代码阶段 finalize：任务分支及 main 实际远端 SHA 均核实为 `9783f2c446aa7f73904d8047f01ac92bfa5fa67b`；main 快进合入，无 PR，干净任务 worktree 和已合并的本地／远端任务分支均已清理。
- 正式阶段从稳定 main 重新 prepare，候选封存及源码 fingerprint 有效，现役 healthy／Forwarding ready，定义不变。
- 正式 deploy 被自动审批拒绝，命令未创建进程、未执行 Stop。拒绝理由是未见针对本次具体生产部署及短暂停服副作用的明确授权；不通过其他入口绕过。只读复查确认旧实例健康、转发 ready、配置未变、原数据保留，候选尚非现役程序。Task 5 的部署及在线验收保留未完成，等待用户明确授权。
