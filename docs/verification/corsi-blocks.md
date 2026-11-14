# Corsi 方块验收记录

范围：[已批准 spec](../scope/2026-11-14-corsi-blocks.md)。实施日期：2026-11-14。新增正序／倒序顺序记忆，保持三种 N-back 的规则版本、分数及旧 payload 不变。全部测试使用隔离 SQLite，不向正式库写测试身份或成绩。

## 行为证据

| 验收项                                                         | 实际证据                                                                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 每级两题、整题判定、正倒序索引、首题失败优先降级、0 格不入最佳 | `tests/corsi.test.ts`、`tests/corsi-server.test.ts` 与 `tests/e2e/corsi.spec.ts`                                                               |
| 不设固定玩法长度上限、9→10 继续、不同题且无相邻重复            | 引擎固定随机源和浏览器可见刺激驱动作答；极端安全整数不静默截短                                                                                 |
| 每批最多 256 步、取消与资源失败不计结果                        | 生成调用计数、取消测试、超长起点浏览器恢复测试；未实际分配巨量内存                                                                             |
| 亮／空各 500 ms、最后留空、100/101 ms 及漏交付判废             | 单调时钟＋提交回执测试；浏览器真实前台阻塞 1200 ms 后无上传、起点不降级                                                                        |
| 正常开局重新校验、游客进度仅当前文档、登录不补传               | 浏览器方向切换、刷新、显式游客、离线 Service Worker 及存储观察                                                                                 |
| 保存重试、响应丢失、当前进度与本局建议值区分                   | 原结果 ID 重试、已保存但进度读取失败只重查、跨标签页账号切换拒绝错误归属                                                                       |
| 完成时间及世代                                                 | 设备日期修改仍使用服务端锚点；5000 ms 接受、5001 ms 拒绝；旧世代迟到只入历史／最佳，恢复响应丢失不重复 POST                                    |
| 私人数据与稳定顺序                                             | 匿名／吊销会话拒绝、身份／Origin／世代负向测试、23 条分页、两用户／两方向隔离、跨表 ID 双向冲突                                                |
| 核心 schema 1 与旧程序兼容                                     | 从 Git 基线 `eaa686a` 物化真实旧 Store，创建带用户、凭据、会话及 N-back 结果的旧库后升级；旧程序重新打开含附加表的库，再用新程序打开，指纹保持 |
| 附加表数据保护                                                 | 两表存在性、既有行及世代指纹；删除已有空表或恢复世代表使保留检查失败；尚无附加表的旧库可首次升级                                               |
| 可访问性与窄屏                                                 | 原生方块按钮／数字键／触屏，长按不重复，取消默认聚焦、Esc 关闭原生恢复对话框并返回触发点；390×844 模拟触屏无整页横向溢出                       |
| 原生后台                                                       | Chromium CDP 在两方向的展示、复现、题间反馈分别触发真实 hidden 事件，未上传结果；不以模拟 document.hidden 代替                                 |

正常流程的 Playwright 时钟按 20 ms 推进，让每个真实 DOM 相位提交后再读可见刺激；测试不调用答案接口。前台阻塞和原生后台使用真实时钟。原生脚本先等待新 Chrome 配置的启动帧稳定，避免将启动停顿与待测后台事件混淆，产品的 100 ms 判废门槛未放宽。六项 Corsi 原生后台用例在隔离库创建真实会话，不消耗其他回归场景的 HTTP 登录额度；登录限流保持每 IP 每分钟 20 次。

RED 证据：规则初始断言因缺少 Corsi 标识失败；HTTP progress 初始返回 404；浏览器在真实归档基线构建上因 Corsi 卡片数量为 0 失败。补齐实现后对应测试通过；浏览器启动环境错误和测试 fixture 错误未作为 RED。

## 验证命令

环境：Windows、Node.js v26.12.0，锁定依赖未变；浏览器使用已安装 Chrome，设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`，未新增依赖。

| 命令／检查                                    | 结果                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`                           | 通过                                                                    |
| `npm run build`                               | 通过                                                                    |
| `npm test`                                    | 110/110 通过                                                            |
| `npm run test:e2e`                            | 62/62 通过                                                              |
| `E2E_BASE_PATH=/braingym/` 的同构建浏览器测试 | 62/62 通过，finally 清除环境变量                                        |
| `git diff --check`、变更文件凭据／产物扫描    | 通过，未发现凭据或禁止产物                                              |
| `npm run rehearse`                            | 通过：独立构建、110 项 Node、双路径各 62 项浏览器、真实 Vite 及隔离 Hub |
| 正式发布与状态／在线验收                      | 通过：published / verified，真实 HTTPS 正倒序游客完整局无上传           |

桌面准备、正倒序结果、个人记录和移动触屏截图由浏览器测试生成到忽略的 `test-results/`；不提交带测试账号信息的截图。Corsi 规则、架构及运维文稿经过起草、独立优化、主代理核对和独立只读复核。

## 隔离候选

代码提交为 c63c70e（feat: add adaptive Corsi block memory training）。候选目录名为 c63c70e2e4b7-d15da7c1-c245-4002-ab31-0bc96e9ce03d，保存在稳定主工作区的 .runtime/releases/candidates/，不随任务 worktree 清理。演练的真实隔离 Hub 确认迁移成功、备份失败恢复、程序回退数据保留及全局 Reload 保护均通过。

正式发布前只读核验：现役定义无需改变，Node 版本匹配，HTTPS、Secure Cookie、前缀路径及回环绑定有效。代码阶段已推送并核对 main，任务分支及 worktree 已清理；随后从稳定 main 重新 prepare Git 上下文执行正式发布。

## 正式发布

显式执行 `npm run release -- deploy --candidate $releaseCandidate`，其中 `$releaseCandidate` 指向上述已演练候选；发布操作 `28a91a0c-4fbc-4a5f-b11e-ce974ae0aa82` 返回 `passed: true`、`state: published`。随后 `npm run release -- status` 返回 `published / verified`。

- 正式程序位于 `D:\Apps\BrainGym`，程序提交为 `c63c70e2e4b7805814072e2381753d2fa13f8807`，发行标记为 `ab06fda8b89132696b169efde3c37cbdb583188eedb2ca0d9b5ae39bd90cc803`，与候选摘要一致。
- 实际日志确认 `definitionWritten: false`、`loadRequested: false`，未修改 Hub 定义、未全局 Reload；`dataPreserved: true`，既有用户、凭据、会话和历史指纹保持。核心 schema 为 1，两张 Corsi 附加表均存在。
- 发布工具的回环及真实 HTTPS 健康、静态资源、发行标记和浏览器检查通过。额外正式冒烟完成两方向游客完整局，成绩为未通过起始 2 格，上传请求为 0，无页面异常。
- 新增 progress 匿名读取为 401；恢复及成绩写入在匿名且 Origin 正确时为 401，错误 Origin 为 403，响应均 `no-store`。实际入口返回 CSP 防嵌入、`X-Content-Type-Options: nosniff` 和 `Referrer-Policy: same-origin`。
- Cookie 的 Secure 和路径配置来自真实现役定义核验；有效登录、Cookie 属性和成绩写入回归使用隔离数据库。正式库只执行发布所需的完整离线备份及只读保留核验，未创建测试身份或成绩。
- 实际 HTTPS 响应仍无 HSTS 和 `Permissions-Policy`，与[此前验收](n-back-button-feedback.md)一致，保留为 P2 加固项，本次未更改代理或放宽应用策略。

只读及游客冒烟脚本保存在忽略的 `.runtime/corsi-verify-live.mjs`，只输出布尔值与状态码，不输出真实入口或凭据。桌面／移动截图保留在稳定主工作区 `.runtime/corsi-blocks-evidence/`。候选、完整备份和发布现场均保留在受保护的 `.runtime/releases/`。

## Findings

按最终文件列表与实际 diff 检查认证／会话、数据访问、浏览器暴露、网络部署、凭据文档、依赖与测试。未发现本次变更的 P0／P1 阻塞问题。P2：实际 HTTPS 入口仍缺少 HSTS 和 Permissions-Policy，相关响应头入口为 [app.ts:59](../../src/server/app.ts#L59)，属于既有加固缺口。会话决定全部读写用户，预期用户仅作前置校验；SQL 参数绑定、8192 字节上限、Origin、CSP、Cookie 与回环绑定未放宽。新表与旧表统一冲突校验，服务端复算，进度恢复使用事务和世代比较。依赖与锁文件未变，本次不要求新增 audit。

## Verification

实际命令和结果见上表及正式发布记录。必需代码门槛、隔离演练、Git main 交付、正式数据保留与在线验收均通过。

## Residual Risk

- 移动输入采用 Chromium 模拟视口和触屏；未验证真实手机／iPad、Safari、主屏幕安装模式及物理锁屏。
- DOM 提交回执不能证明屏幕像素实际呈现；调度异常可能使一局安全作废，不会计作答错或改变起点。
- 保持既有信任模型：服务端校验摘要及归属，不证明真实游玩过程。

- HSTS／Permissions-Policy 仍为既有代理加固项；旧 PWA 页面遵循等待更新策略，需关闭全部 BrainGym 标签页和独立窗口后重新打开已准备的新版本。
