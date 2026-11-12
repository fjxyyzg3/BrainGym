# BrainGym

简体中文的 Web 健脑游戏合集。首版提供九宫格空间 N-back，支持游客练习、个人 Token 登录、私人训练历史与 1～5-back 最佳成绩，适配电脑和手机。

## 本地启动

需要 Node.js 24 或更高版本。

```powershell
npm ci
npm run build
npm run cli -- user:create "我的训练账户"
npm start
```

打开 **http://127.0.0.1:3000**。创建命令输出用户 ID 和一次性的明文 Token，请妥善保存；在页面选择“Token 登录”后粘贴 Token。用户与记录默认保存在 `data/braingym.sqlite`，创建用户和启动服务必须使用相同的数据库路径。

`.env.example` 记录可用配置。Node 进程可用 `node --env-file=.env dist/server/server/main.js` 加载自行创建的 `.env`；`npm start` 本身使用进程环境及默认值，不自动读取该文件。

开发时开两个终端：`npm run dev` 启动 API（3000），`npm run web` 启动 Vite（默认 5173）。此时将 API 的 `APP_ORIGIN` 设为 `http://127.0.0.1:5173`，从该地址访问前端；浏览器的 API 请求由 Vite 同源代理。

## WheelMaker 托管

构建后，先从私有部署配置设置当前终端的 `APP_ORIGIN`，再运行 `./scripts/configure-wheelmaker.ps1` 预览当前 Windows Hub 的 BrainGym 定义；也可通过 `-AppOrigin` 显式传入该值。入口必须是无路径、查询参数、fragment 或凭据的 HTTPS origin，缺失或无效时脚本直接退出。加上 `-Apply` 后会备份并合并该定义。随后在桌面客户端的当前 Hub 中 Reload Monitor，确认 BrainGym 就绪并检查 Forwarding。

托管入口为私有 `APP_ORIGIN` 加 `/braingym/`，回环服务为 `http://127.0.0.1:3001`。Hub 直接托管 Node 根进程，沿用 `data/braingym.sqlite`。同一份构建根据 `APP_BASE_PATH` 支持普通运行的 `/` 和托管运行的 `/braingym/`。仓库中的 `apps.example.com` 等域名仅为保留示例，不能作为实际部署值；真实入口与含入口的原始证据不入库。

完整的加载、更新、故障处理和信任边界见 [WheelMaker 运维步骤](docs/wiki/operations.md#接入-wheelmaker)。实际完成情况见 [WheelMaker 验收记录](docs/verification/wheelmaker-integration.md)；配置合并后仍需检查 Monitor 和真实公网业务。

## Docker

```powershell
docker compose up --build -d
docker compose exec braingym node dist/server/server/cli.js user:create "我的训练账户"
```

默认只将服务暴露到本机 `127.0.0.1:3000`，使用 `braingym-data` 命名卷持久保存 SQLite 数据。重建或 `docker compose down` 后再次启动仍保留数据；不要使用 `down -v`，该选项会删除数据卷。

通过 `PORT` 修改宿主机端口时，同时将 `APP_ORIGIN` 改为浏览器实际访问的 origin；例如端口 8080 对应 `http://127.0.0.1:8080`。否则来源校验会拒绝登录和成绩上传。

线上通过 HTTPS 反向代理访问时，将 `APP_ORIGIN` 设为实际 HTTPS origin，`COOKIE_SECURE=true`。写接口严格校验 Origin，必须与浏览器实际访问地址完全一致。直接 HTTP 的本地体验使用 `COOKIE_SECURE=false`；不要将这种配置作为公网生产配置。

## Token 运维

```powershell
npm run cli -- user:list
npm run cli -- token:rotate <user-id>
npm run cli -- token:revoke <user-id>
npm run cli -- token:issue <user-id>
```

`user:create` 同时创建用户并发放 Token。`rotate` 换发 Token，并立即使旧 Token 与该用户全部会话失效，历史保留；`revoke` 停止该用户所有登录；`issue` 仅在没有有效 Token 时发放。数据库只保存凭据摘要，无法找回旧明文。在容器中运行时，将命令前缀替换为 `docker compose exec braingym node dist/server/server/cli.js`。

## 验证

```powershell
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试使用独立的 `data/e2e-*.sqlite`，不会操作默认账户库；可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已有 Chromium。测试覆盖游客结果不补传、前台中断、移动端输入、上传失败、响应丢失、身份失效及跨标签页账号切换。

设置 `$env:E2E_BASE_PATH='/braingym/'` 后再次执行 `npm run test:e2e`，验证同一构建在前缀路径下的运行；验证结束后用 `Remove-Item Env:E2E_BASE_PATH` 清除该测试配置。

后台中断场景由原生 Chromium CDP 脚本验证，避免 Playwright 的强制前台设置掩盖真实 `visibilitychange`。Docker 持久化验收可在镜像构建后执行 `./scripts/verify-docker.ps1 -Image <image-name>`，脚本使用并清理专用测试容器和数据卷，不操作应用的数据卷。

游戏规则、数据与接口、部署细节见 [项目 Wiki](docs/wiki/architecture.md)，逐项验证结果见 [验收记录](docs/verification/braingym-mvp.md)。
