# robotaxi-memo Worker

网页的 AI 简报代理：接收结构化测算结果，调用 DeepSeek 生成中文分析简报。

## 设计原则

1. **数字由代码算，LLM 只叙述**：Worker 先构造一份事实草稿，再让模型改写；提示词禁止新增或修改数字。
2. **数字回查**：模型输出中的每个数字都必须出现在事实集合里，否则自动回退到本地草稿。
3. **失败降级**：没有 key、超时、HTTP 错误、数字校验失败，都返回本地草稿，前端不会白屏。
4. **成本控制**：10 分钟内存缓存 + 每 IP 每小时 20 次限流（best-effort，生产建议用 Cloudflare Rate Limiting / KV）。

## 接口

```
GET  /               健康检查（是否配置 key、模型名）
POST /api/memo       生成简报
OPTIONS /api/memo    CORS 预检
```

请求体（前端已按此格式发送）：

```json
{
  "city": "广州",
  "inputs": {
    "base_daily_orders": 1389454,
    "traditional_fleet": 103305,
    "traditional_daily_orders_per_vehicle": 13.45,
    "robotaxi_daily_orders_per_vehicle": 13.45,
    "as_of": "2026-06",
    "note": "政府月报；订单由单车订单 × 日均活跃车辆派生。"
  },
  "net_substitution_ratio": 1,
  "scenarios": [
    { "pressure": 0.05, "robotaxi_needed": 5166, "traditional_fleet_after": 98139, "traditional_reduction_pct": 5 }
  ]
}
```

响应：

```json
{ "memo": "...", "model": "deepseek-chat", "fallback": false }
```

失败时 `fallback: true`，`memo` 为本地草稿，`reason` 说明原因。

## 部署

### 方式 A：Dashboard 单文件（无需 token / CLI，最稳）

1. 打开 https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Worker**；
2. 命名 `robotaxi-memo` → **Deploy**；
3. 点 **Edit code**，全选删除，粘贴 `worker/dist/worker.js` 的全部内容 → **Deploy**；
4. **Settings → Variables and Secrets → Add**：
   - 名称 `DEEPSEEK_API_KEY`，类型 **Secret**，值填 DeepSeek key；
5. 复制 workers.dev 地址（形如 `https://robotaxi-memo.<子域>.workers.dev`）。

源码改动后重新生成单文件：

```bash
python scripts/bundle_worker.py
```

### 方式 B：wrangler CLI

```bash
cd worker
npx wrangler login            # 或者设置 CLOUDFLARE_API_TOKEN
npx wrangler deploy
npx wrangler secret put DEEPSEEK_API_KEY   # 粘贴 DeepSeek key
```

`wrangler deploy` 会输出形如 `https://robotaxi-memo.<你的子域>.workers.dev` 的地址。

### 方式 C：Dashboard 多文件

1. Cloudflare Dashboard → Workers & Pages → Create → Worker；
2. 把 `src/memo.js` 与 `src/index.js` 放入编辑器（或改用 CLI）；
3. Settings → Variables and Secrets → 添加加密变量 `DEEPSEEK_API_KEY`；
4. 部署后复制 URL。

> 如果浏览器登录 Cloudflare 不稳定，可以在 Dashboard 创建 API Token（模板：Edit Cloudflare Workers），
> 然后本地 `set CLOUDFLARE_API_TOKEN=...` 再 `npx wrangler deploy`，无需浏览器 OAuth。

## 本地开发

```bash
cd worker
cp .dev.vars.example .dev.vars   # 填入 DEEPSEEK_API_KEY
npx wrangler dev
```

不填 key 也能跑：接口会直接返回本地草稿（`fallback: true`）。

## 前端接入

部署后把 Worker 地址填到 `web/config.js`：

```js
window.ROBOTAXI_CONFIG = { apiBase: "https://robotaxi-memo.<你的子域>.workers.dev" };
```

未填写时，网页仍可正常使用本地文字摘要。

## 测试

```bash
cd worker
node test/memo.test.js
```

覆盖：草稿数字、数字回查拦截编造数字、payload 校验、提示词约束。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | 必填（secret）；缺失时回退本地草稿 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `ALLOWED_ORIGINS` | 逗号分隔的允许来源，默认包含 GitHub Pages 与本地预览 |

## 局限

- 限流与缓存是**单 isolate 内存**，多实例下不共享；生产请接 KV / Durable Objects / Cloudflare Rate Limiting。
- 未做用户鉴权；作为公开 demo，请控制预算并关注用量。
- 数字回查是保守策略：模型一旦写出事实之外的大数字就回退，宁可少一点“文采”，也不放任编造。
