# 位置＋颜色 N-back Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供独立的位置＋颜色 N-back，双路输入与计分、按模式保存和查询，并闭合结果到记录再返回训练的导航。

**Scope Source:** [已批准 spec](../../scope/2026-11-13-spatial-color-n-back.md)，含用户批准的三条跨页导航规则。

**Architecture:** 扩展共享结果为游戏标识可辨别联合，原空间结果保持扁平统计，新模式使用 position/color 两组 Counts。共用 NBackGame 时序与中断，Store 复用现表并按会话用户、模式和版本查询；客户端导航传递公开模式上下文，不持久化私人结果。

**Tech Stack:** React 19、TypeScript strict、Fastify 5、node:sqlite、Vite 7、Node test、Playwright。

**Verification:** 聚焦新模式 Node/浏览器测试；最终依次 typecheck、build、test、test:e2e，再同构建前缀 test:e2e；隔离数据库、原生 CDP 后台、PWA、截图、rehearse 和中文安全审查。

---

## Git 与运行基线

- 分支 `feat/spatial-color-n-back`，worktree `.worktree/feat/spatial-color-n-back`，继承 scope 的 prepared 上下文；原 spec 已批准并提交。任务分支已快进到新增环境隔离功能的 main 基线。
- 本任务仅拥有本 spec、本 plan、下列实现/测试及对应 Wiki/验收文档；不触碰私有配置、正式账户库或 Hub。新 AGENTS 的正式发布阶段与本 spec 的仓库交付边界分开记录，本次不以代码交付冒充正式发布完成。
- 文档工作单元通过格式/链接/敏感文本检查后 checkpoint。代码任务依赖紧密，阶段测试通过后先保留修改；完整仓库门槛全部通过后统一 checkpoint，避免提交未完成或类型不兼容的中间状态。

### Task 1: 共享双路合同、引擎与服务端

**Files:** Modify `src/shared/contracts.ts`, `src/shared/rules.ts`, `src/client/game.ts`, `src/server/store.ts`, `src/server/app.ts`; Create `tests/color-n-back.test.ts`; Modify `tests/server.test.ts` 的空间 fixture 类型（不改变断言）。

**Acceptance:** 新模式可合法保存、服务端复算，原合同/幂等保留；两维独立作答、每路合计 30，模式隔离且非法查询拒绝。

- [x] RED：先用真实 Store/buildApp 与临时数据库验证新模式 POST 应为 200、双路分数复算为 75，未知和重复 game 查询应为 400；运行 `node --import tsx --test tests/color-n-back.test.ts`，记录缺失新模式导致的断言失败。

```ts
assert.equal(saved.statusCode, 200);
assert.equal(saved.json().score, 75);
assert.equal(
  (await app.inject({ url: "/api/history?game=unknown", headers: { cookie } }))
    .statusCode,
  400,
);
```

- [x] GREEN：新增 COLOR_GAME/GameId/SpatialResultInput/ColorResultInput 和结果联合；generateColorSequence 独立调用九候选/六候选生成器，scoreResult 分派计分。扩展现引擎参数、快照与维度输入；服务端规范化 position/color，保持旧字段顺序和原 JSON 幂等语义；history/bests 增加缺省为空间模式的 game 参数。
- [x] 规则/引擎覆盖：所有 N 的范围与退化重抽；已知四种匹配组合序列、warmup/留空/重复/同轮双输入；双路统计及复制隔离；完成/中断。服务端覆盖任一路坏统计、缺路、未知版本、假分数、跨模式同 ID、模式/N 最佳、分页/旧接口、撤销和跨用户授权。
- [x] 回归：`node --import tsx --test tests/rules.test.ts tests/game.test.ts tests/color-n-back.test.ts tests/server.test.ts` 通过；阶段 checkpoint 等待 Task 3 完整门槛。

### Task 2: 大厅、双路交互、结果与记录导航

**Files:** Modify `src/client/App.tsx`, `src/client/styles.css`; Create `tests/e2e/color-n-back.spec.ts`; Modify `tests/e2e/app.spec.ts`, `tests/e2e/pwa.spec.ts`, `scripts/check-native-visibility.mjs`（原模式大厅选择限定到对应卡片，并扩展真实后台验证）。

**Acceptance:** 新模式独立入口，六色刺激、F/J/触屏独立标记，结果显示双路统计与综合分，记录切换及三条导航规则正确。

- [x] RED：先新增浏览器用例，从大厅查找“位置＋颜色 N-back”，要求两个匹配按钮和结果后的对应模式记录；原构建上运行 `npm run test:e2e -- --grep 'dual mode'`，确认因新入口缺失而断言失败。
- [x] GREEN：在现有 hash 路由增加 color-n-back；Training 按游戏 key 挂载，确保模式切换也中断旧局。原模式保留空格，新模式 F/J，忽略 repeat、组合键与输入控件；每维按钮使用原生 button、独立 aria-pressed 和可见文字反馈。六色用固定本地色板，留空不泄露刺激。
- [x] 结果/记录：Outcome 保存固定 game 与结果联合；两路统计分别展示并使用共享 scoreResult。App 显式传递结果模式到 Records，普通记录入口初始化 GAME；Records 当前模式同时驱动查询、分页和所有训练入口，模式与账户变化清理过期请求。双路历史使用有维度标签的统计，不合并为 60 次。
- [x] 浏览器验收：用真实时钟控制完成游客与登录局、F/J 同轮去重与长按、移动触屏、已知刺激对比、手动保存重试、跨标签页身份变化、模式记录/N 最佳、跨页三条规则和直接模式路由切换作废；PWA 真 worker 离线新模式游客不补传。
- [x] 视觉：桌面/390px 截图检查九宫格、六色色板、双按钮、双路结果、模式记录无溢出；保留键盘焦点与缩放，实际手机/锁屏未取得的证据单列。

### Task 3: 完整验证、文档、演练与 Git 收尾

**Files:** Modify `README.md`, `docs/wiki/n-back.md`, `docs/wiki/architecture.md`; Create `docs/verification/spatial-color-n-back.md`; update current plan checkboxes and evidence.

**Acceptance:** spec 每条验收都有本次证据或明确限制；旧空间玩法、身份隔离、PWA 与双路径无回归；完成已授权代码阶段 Git 工作流。

- [x] 依次运行 `npm run typecheck` → `npm run build` → `npm test` → `npm run test:e2e`；失败先修复根因，再重跑受影响门槛，不并行构建与运行时测试。
- [x] 同一构建设置 `$env:E2E_BASE_PATH='/braingym/'` 再运行 `npm run test:e2e`，finally 删除该变量；两种模式均走原生 Chromium CDP 后台验证。所有脚本显式使用临时/独立 SQLite。
- [x] 使用 wiki 技能同步已实现规则、合同、导航及身份边界；README 增加新模式说明。验收记录包含 RED/GREEN、最终命令、截图结论、未做真机项及 Findings/Verification/Residual Risk。
- [x] 运行 `npm run rehearse` 生成独立候选，按现有隔离演练入口验证候选；不执行正式 deploy 或 Hub 控制，不读取/输出正式凭据。
- [x] 检查 status/stat/实际 diff、.gitignore/.dockerignore 与本任务敏感信息扫描，核实不引入依赖或数据库迁移；格式检查只覆盖本次文件。
- [x] git-workflow checkpoint 提交通过完整门槛的实现；finalize 刷新并同步远端、push 和核验 SHA，按偏好合入 main 并清理已合并且干净的任务分支/worktree，不包含任务外改动。阶段完成后从稳定 main 记录交付状态，正式发布仍按 spec 授权范围单列。

## 执行证据

- 2026-11-13：服务端 RED 为新模式保存 400≠200、未知 game 查询 200≠400；浏览器 RED 为新模式大厅卡片不存在。
- Task 1 GREEN：27 个聚焦 Node 测试通过（含新增 10 个双路测试），原空间合同与输入测试保持通过。
- Task 2 GREEN：9 个新模式浏览器用例通过；原生 CDP 分别验证两种模式的后台作废。桌面结果、记录与 390px 双按钮截图已检查，无溢出；实际手机与锁屏未验证。
- 完整门槛：typecheck、build、npm test 已通过，Node 全套 86/86；最终同构建根路径和前缀各 26/26 通过。上述门槛在实现 checkpoint 前完成，后续仅更新验收及收尾文档。

- 文档已完成专用代理优化与独立只读复核；最后一次完整门槛包括六色色板命名分组语义，全部通过。

- 实现 checkpoint：8540adb；隔离 rehearse 从该提交重建，8 项检查与真实隔离 Hub 的备份失败恢复、回退、数据保留和 Reload 保护均通过，封存/源码一致性核验通过。代码阶段按原 spec 未执行正式 deploy；后续新增授权及结果见下节。

- Git finalize：任务分支及 main 推送的实际远端 SHA 均核验为 1295cc6；任务 worktree、本地和远端任务分支已清理，无 PR。收尾文档从稳定 main 新建 Git 上下文；main 与候选只读一致性校验通过，正式发布仍未执行。

## 正式发布阶段（用户后续授权）

用户在代码交付后明确要求沿用已演练候选部署正式环境并完成发布验收。此新增阶段使用稳定 main 的新 Git 上下文；前述代码阶段的部署排除项不限制本次授权。

- [x] Git prepare：main 干净，远端已同步；核验原候选封存、源码与现役定义，确认无需全局 Reload。
- [x] 使用既有 `npm run release -- deploy --candidate` 发布，完整停服备份后替换程序；工具返回 published，status 为 verified。
- [x] 核验 Monitor/Forwarding、真实 HTTPS、发行标记、安全头、匿名拒绝、数据保留、配置不变和非目标实例不变。
- [x] 在真实入口仅用游客验收新模式 F/J、分项及综合计分、手机视口和 PWA 离线；无测试成绩上传，验收后再核对既有数据保留。
- [x] 同步 spec 的新增授权及验收记录，保留真机覆盖与 HSTS/Permissions-Policy 加固项；本次只修改文档，复用有效应用验证。

本阶段文档完成针对性检查后执行 Git finalize，提交、推送及实际远端 SHA 核验结果记于本次最终报告，不预记尚未执行的动作。
