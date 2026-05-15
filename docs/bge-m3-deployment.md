# bge-m3 本地 Embedding 部署方案

> BAAI/bge-m3 — 开源中英多语言 Embedding 模型，1024 维，零 API 费用。

## 选择理由

| 维度 | bge-m3 | OpenAI text-embedding-3-small | voyage-3-large |
|------|--------|------------------------------|----------------|
| 中→英跨语言 | **最好**（中文 native 模型） | 一般 | 好 |
| 学术文本 | 好 | 一般 | **最好** |
| 维度 | 1024 | 1536 | 1024 |
| 费用 | **免费** | $0.02/M token | $0.06/M token |
| 部署 | 本地 GPU/CPU | API | API |
| 网络依赖 | 无 | 需外网 | 需外网 |
| MTEB 多语言 | 前列 | 中游 | 前列 |

望野场景核心需求 **中文查询 → 匹配英文论文**，bge-m3 为此设计。

## 架构

```
docker-compose
├── ollama (:11434)              ← 本地 Embedding 服务
│   image: ollama/ollama:latest
│   model: bge-m3 (1024d)
│   volumes: ollama_models (模型持久化)
│
├── db (:5432)                   ← PostgreSQL + pgvector
│
└── app (:3400)                  ← data-platform
    EMBED_BACKEND=ollama
    EMBED_API_URL=http://ollama:11434
```

## 部署步骤

### 1. 拉取模型

首次启动时自动拉取（约 2.2 GB），后续启动从 volume 加载（秒级）：

```bash
# 手动预拉取（可选）
docker compose run --rm ollama-init
```

### 2. 启动

```bash
docker compose up -d --build
```

### 3. 验证

```bash
# 测试 Embedding
curl http://localhost:11434/api/embeddings \
  -d '{"model":"bge-m3","prompt":"机器学习"}'

# 测试混合检索
curl -X POST http://localhost:3400/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"深度学习注意力机制","maxResults":5}'
```

### 4. 预热（生产建议）

bge-m3 首次加载到 GPU/内存需要 ~10 秒。建议在服务启动后立刻触发一次预热请求：

```bash
curl http://localhost:3400/api/health
```

`src/index.ts` 启动时自动预热：发送一条短文本 embedding 请求，确保模型已加载。

## 硬件要求

| 场景 | 配置 | 速度 |
|------|------|------|
| **CPU** | 4 核 + 8GB RAM | ~200ms/条 |
| **GPU (T4/RTX 3060)** | 8GB VRAM | ~20ms/条 |
| **GPU (A10/RTX 4090)** | 24GB VRAM | ~10ms/条 |

MVP 用 CPU 即可，单次搜索仅需 1 条 embedding（用户查询）。文档 embedding 是异步后台任务，不阻塞采集。

## 环境变量

```bash
# .env 或 docker-compose environment
EMBED_BACKEND=ollama          # ollama | openai | voyage
EMBED_MODEL=bge-m3            # 模型名（ollama list 可查）
EMBED_API_URL=http://ollama:11434  # Ollama API 地址
# 无需 API_KEY
```

## 切换回 API 模型

如需切换回 OpenAI 或 Voyage：

```bash
# OpenAI
EMBED_BACKEND=openai
OPENAI_API_KEY=sk-xxx

# Voyage
EMBED_BACKEND=voyage
VOYAGE_API_KEY=vp-xxx
```

pgvector `vector(1024)` 对 bge-m3 和 voyage-3-large 通用（都是 1024 维）。OpenAI 也可以降维到 1024。

## 故障排查

### 模型拉取失败

```bash
# 手动进入 ollama 容器拉取
docker compose exec ollama ollama pull bge-m3

# 检查模型列表
docker compose exec ollama ollama list
```

### 内存不足

bge-m3 在 CPU 上需 ~4GB 可用内存。如果 Docker 容器 OOM：

```yaml
# docker-compose.yml ollama 服务
deploy:
  resources:
    limits:
      memory: 8G
```

### GPU 不可用

Ollama 自动检测 GPU。强制 CPU：

```bash
# docker-compose.yml ollama service
environment:
  CUDA_VISIBLE_DEVICES: ""
```

### Embedding 返回空

检查 Ollama 是否已加载模型：

```bash
curl http://localhost:11434/api/tags
```

## 参考

- [bge-m3 HuggingFace](https://huggingface.co/BAAI/bge-m3)
- [Ollama 文档](https://ollama.com/library/bge-m3)
- [MTEB 排行榜](https://huggingface.co/spaces/mteb/leaderboard)
