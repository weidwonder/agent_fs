# 运维手册

> Agent FS 云端知识库日常运维参考

---

## 1. 服务管理

### 启停服务

```bash
cd docker

# 启动全部服务
docker compose up -d

# 停止全部服务（保留数据）
docker compose down

# 重启单个服务
docker compose restart server
docker compose restart worker

# 查看服务状态
docker compose ps

# 查看实时日志
docker compose logs -f server worker
```

### 健康检查

```bash
# HTTP 健康检查
curl http://localhost:3000/health
# 期望返回: {"status":"ok"}

# PostgreSQL 健康检查
docker compose exec postgres pg_isready -U agentfs

# MinIO 健康检查
docker compose exec minio mc ready local
```

建议在监控系统（Prometheus / UptimeRobot / 自定义脚本）中配置对 `/health` 端点的定期探活。

---

## 2. 日志管理

### 查看日志

```bash
# 全部服务日志
docker compose logs --tail=100

# 仅 server 日志
docker compose logs -f --tail=50 server

# 仅 worker 日志（索引任务详情）
docker compose logs -f --tail=50 worker

# 按时间范围查看
docker compose logs --since="2024-01-01T00:00:00" --until="2024-01-02T00:00:00" server
```

### 日志轮转

Docker 默认日志驱动（json-file）会无限增长。生产环境建议在 `docker-compose.yml` 中为每个服务添加日志限制：

```yaml
services:
  server:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

或在 Docker daemon 级别配置 `/etc/docker/daemon.json`：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
```

---

## 3. 数据备份与恢复

### 3.1 PostgreSQL 备份

```bash
# 导出完整备份
docker compose exec postgres pg_dump -U agentfs agentfs > backup_$(date +%Y%m%d).sql

# 仅备份数据（不含 schema，方便用 migration 重建结构）
docker compose exec postgres pg_dump -U agentfs --data-only agentfs > data_$(date +%Y%m%d).sql
```

### 3.2 PostgreSQL 恢复

```bash
# 停止 server 和 worker 防止写入冲突
docker compose stop server worker

# 恢复备份
cat backup_20240101.sql | docker compose exec -T postgres psql -U agentfs agentfs

# 重启服务
docker compose start server worker
```

### 3.3 MinIO (S3) 备份

```bash
# 使用 mc 工具同步到本地目录
docker run --rm --network docker_default \
  -v /path/to/backup:/backup \
  minio/mc sh -c "
    mc alias set src http://minio:9000 minioadmin minioadmin;
    mc mirror src/agentfs /backup/agentfs
  "
```

### 3.4 MinIO 恢复

```bash
docker run --rm --network docker_default \
  -v /path/to/backup:/backup \
  minio/mc sh -c "
    mc alias set dst http://minio:9000 minioadmin minioadmin;
    mc mirror /backup/agentfs dst/agentfs
  "
```

### 3.5 自动备份脚本

```bash
#!/bin/bash
# backup.sh — 放入 crontab: 0 2 * * * /path/to/backup.sh
set -e
BACKUP_DIR="/data/backups/agentfs"
DATE=$(date +%Y%m%d_%H%M)
mkdir -p "$BACKUP_DIR"

# PostgreSQL
docker compose -f /path/to/docker/docker-compose.yml \
  exec -T postgres pg_dump -U agentfs agentfs \
  | gzip > "$BACKUP_DIR/pg_${DATE}.sql.gz"

# MinIO
docker run --rm --network docker_default \
  -v "$BACKUP_DIR":/backup minio/mc sh -c "
    mc alias set src http://minio:9000 minioadmin minioadmin;
    mc mirror --overwrite src/agentfs /backup/s3_${DATE}
  "

# 清理 30 天前的备份
find "$BACKUP_DIR" -name "pg_*.sql.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "s3_*" -type d -mtime +30 -exec rm -rf {} +

echo "[$(date)] Backup complete: $BACKUP_DIR"
```

---

## 4. 扩容

### 4.1 水平扩展 Server

Server 是无状态的，可直接增加实例数：

```bash
docker compose up -d --scale server=3
```

需在前端部署负载均衡器（Nginx / HAProxy / cloud LB）。注意 SSE 连接需配置长连接支持。

### 4.2 水平扩展 Worker

Worker 通过 pg-boss 自动分配任务，多实例安全：

```bash
docker compose up -d --scale worker=3
```

Worker 扩容不需要负载均衡器，每个实例独立从队列拉取任务。

### 4.3 数据库优化

当数据量增大时：

```sql
-- 查看表大小
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- 查看向量索引状态
SELECT indexname, pg_size_pretty(pg_relation_size(indexname::regclass))
FROM pg_indexes WHERE tablename = 'chunks';

-- 手动 VACUUM（通常 autovacuum 已足够）
VACUUM ANALYZE chunks;
VACUUM ANALYZE inverted_terms;
```

PostgreSQL 调优建议（`postgresql.conf` 或 Docker 环境变量）：

| 参数 | 建议值（8GB RAM） | 说明 |
|------|-------------------|------|
| `shared_buffers` | `2GB` | 共享缓冲区 |
| `effective_cache_size` | `6GB` | 查询规划器参考 |
| `work_mem` | `256MB` | 排序/哈希操作内存 |
| `maintenance_work_mem` | `512MB` | VACUUM/索引创建内存 |

---

## 5. 版本升级

### 标准升级流程

```bash
cd /path/to/agent_fs

# 1. 拉取最新代码
git pull origin main

# 2. 备份数据（见第 3 节）
./backup.sh

# 3. 重新构建镜像并启动
cd docker
docker compose up --build -d

# 4. 检查 migration 是否自动执行
docker compose logs migrate

# 5. 验证健康状态
curl http://localhost:3000/health
```

### 数据库 Migration 注意

- Migration 使用 `CREATE ... IF NOT EXISTS`，重复执行安全
- 新版本若包含新的 migration 文件，Docker Compose 启动时自动执行
- 升级前务必备份，以便回滚

### 回滚

```bash
# 回退代码版本
git checkout <previous-tag>

# 重建并启动
cd docker
docker compose up --build -d

# 如需恢复数据库（仅在 migration 包含不可逆变更时）
cat backup_YYYYMMDD.sql | docker compose exec -T postgres psql -U agentfs agentfs
```

---

## 6. 安全加固

### 6.1 必须修改的默认值

| 项目 | 默认值 | 操作 |
|------|--------|------|
| `POSTGRES_PASSWORD` | `changeme` | 改为强随机密码 |
| `S3_SECRET_KEY` | `minioadmin` | 改为强随机密码 |
| `JWT_SECRET` | `change-me-in-production` | 改为 32+ 字符随机字符串 |

生成随机密码：

```bash
openssl rand -base64 32
```

### 6.2 网络安全

- **不要直接将 3000 端口暴露到公网**，使用 Nginx/Caddy 反向代理并启用 HTTPS
- 限制 PostgreSQL（5432）和 MinIO（9000/9001）端口仅绑定到 `127.0.0.1`
- 生产环境在 `docker-compose.yml` 中修改端口绑定：

```yaml
ports:
  - "127.0.0.1:5432:5432"  # 仅本机可访问
```

### 6.3 HTTPS 配置

推荐使用 Caddy（自动 HTTPS）：

```
kb.example.com {
    reverse_proxy localhost:3000
}
```

或使用 Nginx + Let's Encrypt（见 [MCP 客户端接入指南](mcp-client-integration.md#公网暴露)）。

### 6.4 定期维护

| 任务 | 频率 | 说明 |
|------|------|------|
| 数据备份 | 每日 | 参见第 3.5 节自动脚本 |
| 清理过期 SSE tickets | 自动 | pg-boss 内置清理，无需干预 |
| Docker 镜像更新 | 每月 | `docker compose pull` 更新基础镜像 |
| 检查磁盘空间 | 每周 | `df -h` 和 `docker system df` |
| 查看错误日志 | 每日 | `docker compose logs worker \| grep -i error` |

---

## 7. 监控指标

### 关键监控项

| 指标 | 检查方式 | 告警条件 |
|------|---------|---------|
| 服务存活 | `GET /health` | 非 200 或超时 5s |
| 索引队列积压 | 查询 pg-boss 表 | 待处理任务 > 100 |
| 磁盘使用率 | `df -h` | > 80% |
| PostgreSQL 连接数 | `SELECT count(*) FROM pg_stat_activity` | > 80% of max_connections |
| Worker 错误率 | 日志中 `error` 关键词 | 连续 5 次失败 |

### 检查索引队列状态

```sql
-- 连接到 PostgreSQL
docker compose exec postgres psql -U agentfs agentfs

-- 查看待处理任务数
SELECT state, count(*) FROM pgboss.job WHERE name = 'index-file' GROUP BY state;

-- 查看最近失败的任务
SELECT id, data, completedon, output
FROM pgboss.job
WHERE name = 'index-file' AND state = 'failed'
ORDER BY completedon DESC LIMIT 10;
```

---

## 8. 常见运维问题

**Q: Worker 长时间无法处理任务？**

检查 worker 日志，常见原因：
1. Embedding 服务未配置或不可用
2. S3 连接失败（检查 MinIO 是否正常）
3. 内存不足（大文件处理需要较多内存）

```bash
docker compose logs --tail=50 worker
```

**Q: 搜索结果为空？**

1. 确认文件状态为 `indexed`：查询 `/api/projects/<id>/files`
2. 检查 chunks 表是否有数据：`SELECT count(*) FROM chunks WHERE tenant_id = '...'`
3. 确认 Embedding 配置正确（维度需匹配）

**Q: 磁盘空间不足？**

```bash
# 查看 Docker 磁盘使用
docker system df

# 清理未使用的镜像和容器
docker system prune -f

# 清理构建缓存
docker builder prune -f
```

**Q: 需要重建全部索引？**

```sql
-- 将所有文件重置为 pending
UPDATE files SET status = 'pending', chunk_count = 0 WHERE tenant_id = '...';
-- 清空 chunks 和倒排索引
DELETE FROM chunks WHERE tenant_id = '...';
DELETE FROM inverted_terms WHERE file_id IN (SELECT id FROM files WHERE tenant_id = '...');
DELETE FROM inverted_stats WHERE tenant_id = '...';
```

然后重启 worker，它会自动重新处理 pending 文件。
