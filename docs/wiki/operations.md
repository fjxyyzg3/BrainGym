> 摘要：本机开发演练、main 显式发布、WheelMaker 迁移与恢复、PWA 排查及 SQLite 数据保留。

# 启动与管理 BrainGym

## 本地运行

安装 Node.js 24 或更高版本，在项目根目录执行：

```powershell
npm ci
npm run cli -- user:create "开发练习账户"
npm run dev
```

另开终端运行 `npm run web`，打开 `http://127.0.0.1:5173`。开发 API 绑定回环 3002，Vite 绑定 5173 并代理 API。普通 CLI、API 和构建预览使用当前工作区 `.runtime/development/braingym.sqlite`；开发账户及成绩不迁入正式库。

修改端口时，将 `.env.example` 复制为未跟踪的 `.env.development.local`，设置 `DEV_API_PORT`、`DEV_WEB_PORT`。开发入口统一计算 Origin 和代理目标，拒绝 3001、相同端口和开发目录外的数据库。`npm run build` 后的 `npm start` 在回环 3002 预览生产构建，仍使用开发库；开发 Vite 与预览使用不同 Origin。

首次正式迁移前，旧服务可能仍读取原主工作区 `dist`。构建入口发现原默认库而无法确认独立正式发布标记时，会拒绝覆盖原主工作区；使用独立 worktree 或下述候选流程。实际正式位置及本次迁移状态见[环境隔离验收](../verification/dev-production-isolation.md)。

## 安装与使用 PWA

生产构建提供安装资源；公网使用既有 HTTPS 入口，回环 HTTP 仅用于本地开发和验证。Chrome/Edge 通过浏览器菜单安装应用；iPhone/iPad Safari 使用**分享 → 添加到主屏幕**，若系统提供“作为 Web App 打开”，保持开启。图标启动进入当前路径的训练大厅，页面没有安装按钮或安装提示。目标平台的实际验证范围见 [PWA 验收记录](../verification/pwa-support.md)。

首次联网打开后，需要完成公共外壳和静态资源缓存。可断网关闭再打开，检查训练大厅和准备页是否可用；尚未完成缓存、缓存失败或被浏览器回收时需重新联网。断网练习需明确选择**以游客身份练习**，本局成绩只留在当前结果页，不在恢复联网或登录后补传。登录、退出、私人记录和成绩保存需要联网；已有会话不会仅因网络故障被撤销。

已在线验证身份后开始的对局，途中断网仍可完成，保存失败可留在结果页手动重试。刷新或离开会失去待保存结果。未完成对局的离开、切后台或锁屏作废规则同样适用于独立窗口。

新版本会在联网访问、窗口获得焦点或恢复网络时检查并准备；它不强制刷新当前页面。关闭所有 BrainGym 标签页和独立窗口，再打开即可使用已经准备好的版本。仅关闭一个窗口或刷新仍有旧页面的应用，不会主动切换版本。新版下载或校验失败时继续使用完整旧版，重新联网打开后可重试准备。

确需清理异常缓存时，在浏览器开发工具中找到当前应用的 Service Worker 作用域，仅注销该 worker，并删除同一路径对应的 `braingym:pwa:` 缓存。根路径前缀为 `braingym:pwa:%2F:`，托管路径为 `braingym:pwa:%2Fbraingym%2F:`。关闭全部相关页面后联网重开。不要把清除整个 Origin 的站点数据当作常规更新步骤，它会影响同 Origin 其他应用及登录状态；不要删除其他路径的 worker 或缓存。

`npm run web` 不注册生产 worker。若曾在同一 Origin 运行生产版，使用独立开发端口或按上述方法只移除对应 worker。图标由已提交的 PNG 提供，修改原有标识后可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 并运行 `node scripts/generate-pwa-icons.mjs`，从 `public/favicon.svg` 重新生成。

## 恢复 Corsi 起点

Corsi 起点异常或设备无法准备超长序列时，在对应方向准备页选择**从 2 格重新开始**并确认。历史和最佳保留，另一方向不受影响；账号恢复会同步到其他设备，游客只修改当前页面内存。恢复响应丢失时先重新读取起点，重新确认前不要反复提交恢复。完整进度与异常语义见 [Corsi Wiki](corsi.md#进度恢复与异常处理)。

## Docker 运行

```powershell
docker compose up --build -d
docker compose exec braingym node dist/server/server/cli.js user:create "训练账户"
```

服务以非 root 用户运行，默认仅将 3000 端口映射到本机。通过 `PORT` 调整宿主机端口时，必须同步将 `APP_ORIGIN` 改为实际访问的 origin，否则登录和成绩上传会被拒绝。`braingym-data` 命名卷保存 `/app/data`。重建镜像或删除容器不会删除命名卷；`docker compose down -v` 会删除数据，不能用于保留成绩的日常重启。

## 管理凭据

```powershell
npm run cli -- user:list
npm run cli -- token:rotate <user-id>
npm run cli -- token:revoke <user-id>
npm run cli -- token:issue <user-id>
npm run cli:production -- user:list
npm run cli:production -- token:rotate <user-id>
```

`rotate` 换发 Token，旧 Token 无法再次登录，全部旧会话立即失效。`revoke` 吊销凭据和全部会话，`issue` 为已无有效凭据的用户重新发放。用户身份和历史不变；退出网页只撤销当前会话。明文 Token 仅在发放或换发时输出，数据库无法找回旧值。

普通 CLI 管理开发库；`cli:production` 从现有私有 Hub 定义取得现役程序和数据库，直接执行该程序的 CLI，不需要 Registry 在线认证。发布进行中或现场未恢复时，正式 CLI 拒绝写入。CLI 的环境提示在 stderr，JSON 和一次性 Token 在 stdout。

容器内管理继续使用前缀 `docker compose exec braingym node dist/server/server/cli.js`。容器的显式生产数据库和数据卷不参与 WheelMaker 迁移。

## 接入 WheelMaker

安装 Node.js 24+，保留现有正式数据库。正式程序位于 `D:\Apps\BrainGym`，Hub 直接托管 Node 根进程，端口为回环 3001，路径为 `/braingym/`。正式 Origin、数据库绝对位置、应用和服务标识均从原定义继承。服务本身通过本机 IPC 发布，不需要持有 Registry 控制认证；独立发布工具需要该认证。

先在独立开发工作区完成代码和隔离验证，再按 Git 偏好提交、合入并推送 main。代码交付完成后，从稳定 main 工作区执行发布；整个任务要等实际迁移及在线验收完成才算完成。阶段间 main 内容变化时重新核对候选证据；清理任务 worktree 不能删除稳定主工作区 `.runtime/releases/` 内的候选、备份和阶段记录。

在主仓库未跟踪的 `.env.production.local` 中配置现有 `BRAINGYM_REGISTRY_TOKEN`；自定义 Hub 时设置 `WHEELMAKER_STATE_DIR`。限制该文件的访问权限，不提交、打印或传给开发程序。发布入口要求现有 Registry 为 HTTPS，正式 Origin 也必须是无路径、查询参数、fragment 或凭据的 HTTPS origin，`COOKIE_SECURE=true`。

在源码及测试无未提交修改的 main 工作区执行：

```powershell
npm ci
npm run rehearse
$releaseCandidate = '<上条命令输出的 candidate 目录>'
npm run release -- deploy --candidate $releaseCandidate
npm run release -- status
```

`rehearse` 也可在功能分支执行，但正式 `deploy` 只接受对应已提交 main 内容的候选。候选从 Git 提交导出，在隔离目录安装锁定依赖，依次完成 typecheck、build、Node 测试、同一构建的根路径和前缀浏览器测试、真实 Vite 代理演练、生产运行包和隔离真实 Hub 验证。生产依赖在停服前准备，正式目录不执行安装或构建。

验收记录绑定源码内容、锁文件、运行环境和全部运行包文件摘要。源文件未提交、main 与候选不一致、产物被改动或证据失效时，在 Stop 前拒绝。文档等不影响运行的修改不会混入运行包；有效证据可复用，缺失时重新演练。

发布工具预检后记录原运行状态，发出 Stop，确认进程、端口和旧映射收敛。停止同库的其它写入进程后，工具以独占文件句柄备份完整数据库目录，拒绝仍被打开的文件；备份全部成功才替换程序。首次迁移仅将程序运行目录转到独立正式目录，数据库相对路径按原 cwd 固化为绝对路径。

启动后核对 Monitor、Forwarding、程序摘要、本机及真实 HTTPS 页面、安全头、前缀资源、匿名私人接口拒绝和真实浏览器加载。对正式数据库只做只读指纹核验；旧 Token、会话、历史及新成绩写入在隔离数据库中验证，不在正式库创建测试身份。HTTP 健康或 Forwarding ready 单独成立，不代表发布成功。

### 定义变更与全局 Reload

定义未变的常规发布只执行 BrainGym 的 Stop、Start，不写 Hub 配置，也不 Reload。Monitor 的 Reload 会处理全部应用定义，不支持 appId 限定。

首次迁移或定义变化时，工具先核对非目标应用的已加载私有基线、磁盘定义和 Monitor 集合；待加载新增、删除、参数修改或待重启状态都导致拒绝。有其它应用时，不能将当前磁盘配置或简化快照直接充当已加载证明。可信基线位于 `.runtime/releases/loaded-config.json`，仅由已确认的加载过程建立；未重载的常规发布不会覆盖该记录。基线不足时先解决证据缺口，不通过试做 Reload 探测影响。

配置变更在冻结条件下进行，原子替换前核对原摘要并保留同访问权限的旧文件。候选写入后持有允许 Hub 读、拒绝外部写入及替换的文件保护，再执行全局 Reload，核验其它实例的 ID、PID、instanceId、阶段和待重启状态没有本次操作导致的变化。回退执行相同检查，不整体覆盖别人的配置。

`configure-wheelmaker.ps1` 仅用于读取现有定义并预览正式目录设置，`-Apply` 拒绝执行。旧公网预检、正式身份准备和写入式公网验收脚本已经退役。独立验证使用 `npm run verify:release`；其临时 Registry、Hub、Gateway、数据库和账号不会注册到正式服务。

该部署依赖同 Origin 应用可信、发布权限受控，以及网关正确清洗转发头。Cookie Path 和路径前缀不隔离同域应用；完整条件见 [身份与代理信任边界](architecture.md#身份与代理信任边界)。

## 更新或恢复托管实例

更新时重新演练并显式 deploy。Stop 请求一经发出，工具就负责核对并恢复原运行状态，不能以尚未复制程序或新版 PID 不存在为由直接退出。

- Stop 回复丢失：核对同一实例、根进程及端口的实际状态，不把超时当作未执行。
- 已停服但程序未修改：数据库或程序备份失败、仍有文件被打开、磁盘不足或配置冲突时，按原定义恢复服务；原本停止的实例保持停止。
- 程序或定义已修改：先停止本次进程，再从受管备份恢复程序，仅撤回本工具的定义变更，按原状态启动或保持停止。数据库不回滚，已合入 main 的源码不回退。
- 恢复失败或操作中断：保留阶段记录和备份，运行 `npm run release -- status` 查看状态。解决认证、权限、锁或文件问题后运行 `npm run release -- recover`；原操作仍运行时拒绝抢占，未完成现场也阻止后续发布。

私有操作记录和备份位于稳定主工作区 `.runtime/releases/state/`，正式目录只放程序、生产依赖和发行标记。不要删除阶段文件来跳过恢复，也不要把自动恢复改成数据库回滚。恢复成功而新版未发布，仍记录迁移未完成。

## 排查托管故障

- Monitor 未就绪：检查直接 Node 路径、cwd、前端构建、端口冲突及数据库权限，查看 stderr；stdout 只能包含协议帧。
- Monitor 报 storage 异常：检查数据库锁、磁盘和权限，解除故障后确认完整 healthy 快照已清除旧诊断。仅发布失败不会把核心健康标为失败。
- Monitor 就绪但 Forwarding 未就绪：核对两端 `WHEELMAKER_STATE_DIR`、服务 ID、target 及 Hub 的转发配置。应用会自行退避重试；已注册的连接长期无推送，可以是正常状态。
- 登录返回 `503/CLIENT_IP_UNAVAILABLE`：核对请求确实来自回环代理，且网关传入一个非回环客户端 IP；查看脱敏原因分类。修复代理后使用原 Token 重试，不启用共享额度回退。
- 登录或保存返回 403：核对浏览器实际 Origin 与 `APP_ORIGIN`；本机 HTTP 登录不属于托管配置的写入入口。

## 配置 HTTPS 与数据保留

线上使用 HTTPS 反向代理时，将 `APP_ORIGIN` 设置为浏览器实际访问的 HTTPS origin，且无路径和尾斜杠，同时设置 `COOKIE_SECURE=true`。来源不一致的写请求会被拒绝；本地 HTTP 使用 `false`。Compose 仍自动读取其 `.env`。普通 Node 直接运行时按 `BRAINGYM_ENV` 或已有 production/test 标记选择环境，正式与测试必须显式提供 `DATABASE_PATH`；普通 npm 入口固定使用开发配置。

备份前停止 API 及所有管理进程，再复制完整数据库目录；恢复到原路径后重新启动。不要只复制正在写入的 SQLite 主文件，WAL 可能仍包含已提交数据。旧版应用不能直接打开更高版本数据库，当前 schema version 为 1。

Corsi 以 `corsi_results` 和 `corsi_progress_resets` 两张附加表扩展 schema 1，首次打开新程序时原子初始化，重复打开不会重置进度。发布指纹同时保护附加表存在性和既有行；程序回退保留两表及其数据，不手动删除恢复世代表或通过回滚数据库撤销起点。升级、旧程序重新打开与再次升级使用隔离库验证，正式库仅做只读保留核验。

来源：[README](../../README.md)、[环境隔离 spec](../scope/2026-11-13-dev-production-isolation.md)、[环境解析](../../src/server/environment.ts)、[发布入口](../../scripts/release.ts)、[发布状态机](../../scripts/release/deploy.ts)、[文件保护](../../scripts/release-windows.ps1)、[Compose](../../compose.yaml)、[存储](../../src/server/store.ts)。本次真实迁移及验证范围见[环境隔离验收](../verification/dev-production-isolation.md)，历史接入结果见 [WheelMaker 验收记录](../verification/wheelmaker-integration.md)。
