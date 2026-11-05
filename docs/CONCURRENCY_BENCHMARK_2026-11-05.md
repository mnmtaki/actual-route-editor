# 协作并发实测报告 — 2026-11-05

**证据**：GitHub Actions [Manual concurrent editor benchmark #4](https://github.com/mnmtaki/actual-route-editor/actions/runs/42005024394)，commit `5371d2d7df8e3d58a4e81fe627226993a02e2f2b`。

执行方式：`ConcurrentEditorBenchmarkIT`、Spring Boot MockMvc（带真实 Cookie/CSRF 校验）、PostgreSQL 16、GitHub Actions ubuntu-24.04；使用隔离数据库 `actual_route_bench`，无付费外部服务。

## 工况

10 / 20 / 50 个不同账号共享一个工程，每个账号从**同一个旧版 revision=1** 发起独立操作；每档单独建项目，包含 300 个初始车站。场景分别是独立站点创建（`station.create`）和各自线路末端追加车站（`line.append-new`）。

账号注册、登录、项目构建不计入测量时间；每次请求计入 Spring Security、实际 PostgreSQL 事务、行锁等待、操作日志与工程快照写入。所有请求同时从 CountDownLatch 放行。

## 实际测量（一次运行）

| 操作 | 并发账号 | 成功/请求 | 409 冲突 | P50 ms | P95 ms | 成功操作/s |
|---|---:|---:|---:|---:|---:|---:|
| station.create | 10 | 10/10 | 0 | 242.5 | 314.2 | 31.85 |
| line.append-new | 10 | 10/10 | 0 | 102.1 | 154.6 | 61.35 |
| station.create | 20 | 20/20 | 0 | 105.4 | 203.2 | 90.50 |
| line.append-new | 20 | 20/20 | 0 | 102.5 | 185.7 | 103.09 |
| station.create | 50 | 50/50 | 0 | 244.1 | 412.3 | 106.84 |
| line.append-new | 50 | 50/50 | 0 | 198.7 | 390.2 | 118.20 |

共计 **160/160 次成功、0 次意外错误、0 次因不相交资源产生的 409 冲突**。每组都检查最终版本等于 `1 + 成功操作数`，操作日志行数与成功数相等，新增车站／区间数量准确、车站 ID 无重复。原始机器可读 JSON 存放在 [workflow artifact](https://github.com/mnmtaki/actual-route-editor/actions/runs/42005024394#artifacts)。

## 不应外推的结论

- 此结果证明本次服务端事务工况下的并发正确性和吞吐量，**不等于公网 HTTP/TLS/WebSocket 端到端性能**；MockMvc 不经过真实网络链路。
- 单次运行有 JVM/JIT、连接池与机器噪声，10 人与 20 人的数据不能用来声称线性扩展。
- `station.create` 是不涉及线路拓扑的独立操作；`line.append-new` 是不同简单线路，不包含 50 人对同一复杂分叉的冲突压力。
- 未测试 5000+ 站线网、跨多服务器实例、长时负载及持久故障/离线多操作重放。
- 拟在简历里写数据时，必须准确标明“MockMvc＋PostgreSQL 服务端基准，50 并发不同线路”，不能写成“50 人在线画布流畅实时协同”。

## 可靠性与部署佐证

- [CI #316](https://github.com/mnmtaki/actual-route-editor/actions/runs/42004154969)：Java、Web、16 个双浏览器 Playwright 场景成功，新增“服务端已提交但应答丢失”与“协作中权限撤销”的故障注入。
- [Docker smoke #2](https://github.com/mnmtaki/actual-route-editor/actions/runs/42005024376)：PostgreSQL、Java、Nginx 真实容器启动，Cookie/CSRF、工程 REST、Flyway V16 与 WebSocket 101 握手成功。
- 最新开发分支 HEAD 的常规 CI 仍需在每次后续推送后重新确认。

## 下一阶段条件

单实例本地部署和压力测试已取得实际 CI 证据。是否正式公网部署仍需：公网 TLS、备份恢复演练、资源/错误监控、容量预估，以及多实例 WebSocket 消息总线（若要求横向扩容）。复杂复合操作和共享站点仍保持冲突拒绝，不宣称任意编辑无冲突自动合并。
