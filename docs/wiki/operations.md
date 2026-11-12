> 摘要：本地与 Docker 启动、个人 Token 管理、生产配置和 SQLite 数据保留。

# 启动与管理 BrainGym

## 本地运行

安装 Node.js 24 或更高版本，在项目根目录执行：

```powershell
npm ci
npm run build
npm run cli -- user:create "训练账户"
npm start
```

创建命令输出稳定用户 ID 和明文 Token。打开 `http://127.0.0.1:3000`，在“Token 登录”中输入 Token。创建命令与服务默认使用 `data/braingym.sqlite`；自定义 `DATABASE_PATH` 时，两者必须指向相同文件。

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
```

`rotate` 换发 Token，旧 Token 无法再次登录，全部旧会话立即失效。`revoke` 吊销凭据和全部会话，`issue` 为已无有效凭据的用户重新发放。用户身份和历史不变；退出网页只撤销当前会话。明文 Token 仅在发放或换发时输出，数据库无法找回旧值。

容器内管理使用前缀 `docker compose exec braingym node dist/server/server/cli.js`，替换以上 `npm run cli --`。

## 配置 HTTPS 与数据保留

线上使用 HTTPS 反向代理，将 `APP_ORIGIN` 设置为浏览器实际访问的 HTTPS origin，且无路径和尾斜杠，同时设置 `COOKIE_SECURE=true`。来源不一致的写请求会被拒绝；本地 HTTP 使用 `false`。Compose 自动读取 `.env`，普通 `npm start` 不读取，可改用 `node --env-file=.env dist/server/server/main.js`。

备份前停止 API 及所有管理进程，再复制完整数据库目录；恢复到原路径后重新启动。不要只复制正在写入的 SQLite 主文件，WAL 可能仍包含已提交数据。更高版本数据库不能用旧版应用直接打开，当前 schema version 为 1。

来源：[README](../../README.md)、[Compose](../../compose.yaml)、[运行入口](../../src/server/main.ts)、[CLI](../../src/server/cli.ts)、[存储](../../src/server/store.ts)。
