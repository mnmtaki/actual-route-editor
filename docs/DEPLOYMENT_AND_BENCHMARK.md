# 多人协作：单实例部署与压力测试

> 仅适用于 `feat/java-accounts-cloud-saves-20261101` 的开发验收。所有操作必须在独立测试数据库上先完成。该配置不是无需修改即可暴露公网的生产安全模板。

## 1. CI 验收基线

- 普通 CI（`java-cloud-saves-ci.yml`）：Java 21 + PostgreSQL 16/Flyway、TypeScript/Vitest、Playwright 双浏览器。
- 已验证的历史基线：GitHub Actions #305 三项通过；**每次后续提交必须重新核对分支 HEAD 的运行**。
- 新增可靠性测试：丢失成功响应后复用相同 `operationId`；撤销编辑权限后拒绝旧会话写入；通过真实浏览器执行。
- 在网络请求已提交、应答丢失时，允许幂等重放；拒绝过期且有依赖冲突的写入。
- 运行中的几何草稿不等于已提交车站；快速绘制验收必须使用“完成绘制”。

## 2. 单实例 Docker Compose（仅本地/测试环境）

需要 Docker Engine + Compose v2。

```sh
cp deploy/env.example deploy/.env
# 修改 deploy/.env 内的 POSTGRES_PASSWORD
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
curl -i http://localhost:8088/api/auth/me
```

最后一个 GET 预计返回 401（匿名无权查询），但应当证明请求已经被 Nginx 转发到 Java，而不是出现 502/404。

- 访问：`http://localhost:8088`。
- 前端构建时 API 使用同源 `/`；WebSocket 自动使用 `ws://localhost:8088/ws/...`。
- PostgreSQL 数据仅在内部 Docker 网络上暴露，数据保存在命名卷 `postgres_data`。
- Java 后端只连接 Docker 内部数据库，不直接暴露主机端口。
- 默认 HTTP 仅绑定 `127.0.0.1:8088`；不得在公网直接使用默认配置。

**公网部署前必须增加 HTTPS/TLS 入口**，在 `deploy/.env` 中设置 `ARA_ORIGIN=https://你的域名`、`ARA_COOKIE_SECURE=true`，用 TLS 网关承载前端及 WebSocket，并且只暴露允许的端口。多 Spring Boot 实例需要额外的跨实例消息广播（目前不支持）；不能把单机 WebSocket 方案直接扩成多副本。

## 3. 数据库备份与迁移

升级前执行：

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml exec -T database \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U actual_route -d actual_route -Fc' \
  > actual_route_backup.dump
```

备份文件必须转移到安全位置（不要提交 Git、不要放在公开 Web 根目录）。恢复操作需要停止写入、核对备份版本和 Flyway 版本，先在隔离环境验证后再操作正式库。**不能简单删除 PostgreSQL 卷进行升级。**

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=150 backend
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

`down` 不带 `-v`，保留数据库卷。Flyway 启动时执行数据库迁移；不要手改既有迁移 SQL，更不要在已使用的环境中修改迁移校验和。

## 4. 真实并发基准（独立触发）

`manual-concurrency-benchmark.yml` 为专用手动工作流，使用**新建的隔离 PostgreSQL 数据库**，不会操作既有协作数据。

从 GitHub Actions 选择 **Manual concurrent editor benchmark** → **Run workflow**，选择开发分支。该作业运行：

```sh
ARA_RUN_CONCURRENCY_BENCH=true \
DATABASE_URL=jdbc:postgresql://localhost:5432/actual_route_bench \
DATABASE_USER=actual_route DATABASE_PASSWORD=... \
mvn -B -ntp -Dtest=ConcurrentEditorBenchmarkIT test
```

测试分别测 10/20/50 个独立认证账号的两种操作：`station.create` 和 `line.append-new`。所有账号同时基于同一旧版本提交，每项使用独立工程；基准数据中有 300 个初始站点，便于检验 JSON 文档与数据库行锁开销。

每一档记录：

- 每请求 P50/P95（毫秒）、总体吞吐量（成功操作/秒）、总耗时；
- 2xx 成功数、409 冲突数、意外响应数；
- 最终工程版本、操作日志记录数、车站数、区间数；
- 所有独立操作必须成功且版本与日志严格守恒，否则**基准本身失败**。

真实数据在工作流产物 `concurrency-benchmark-results/concurrency-benchmark.json` 中。**未运行之前，不得在 README/简历中填写任何测得 TPS 或延迟。**

这些是 Spring MVC MockMvc + PostgreSQL 的服务端事务基准，不代表经过 HTTP、TLS、浏览器渲染和公网 WebSocket 的端到端性能。要证明公网多人体验，还需实测真实网络与较大项目。

## 5. Docker 构建与单实例链路冒烟

除手动运行外，仓库还提供 `Manual Docker collaboration smoke test`。它在隔离的 CI Docker 主机上构建三项服务，核对 Nginx 静态前端、登录 Cookie、CSRF、工程创建与读取、Flyway V16，以及 WebSocket 101 升级，然后删除临时数据库卷。真实生产环境需要自行提供 HTTPS 和数据库备份。

压力基准与 Docker 冒烟默认不随普通代码修改执行；分别可在 Actions 中手动触发。开发分支的提交信息同时包含 `[bench]` 和 `[deploy]` 时，会触发两项独立的验收工作流，结果依旧必须以实际日志为准。

## 6. 验收范围与未完成项

- ✅ 单实例 PostgreSQL 事务 + 幂等操作 ID 的核心链路已有 CI 证据。
- ✅ 普通画布、简单支线、环线、复合线级拓扑有对应操作和测试。
- ☐ 新加的故障注入测试是否与最新分支 HEAD 一起通过（以 CI 为准）。
- ☐ 10/20/50 账号手动压力基准真实运行及结果归档。
- ☐ Docker Compose 在目标主机上实际构建、启动、WebSocket 穿透与备份恢复演练。
- ☐ 断线状态下多条连续操作离线排队；当前仅安全处理单条不确定操作。
- ☐ 多副本后端共享 WebSocket 广播与负载均衡（不属于此单实例部署）。
- ☐ 所有类型的多人撤销/重做；当前仅部分车站补偿操作。

如果以上未验收项目仍存在，应表述为“核心并发 CI 通过，仍在进行可靠性/容量/部署验收”，而不是宣称生产环境全面就绪。
