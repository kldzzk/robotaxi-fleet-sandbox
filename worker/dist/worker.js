// Bundled single-file Worker for the Cloudflare dashboard editor.
// Generated from worker/src/memo.js + worker/src/index.js.

/* 纯函数：把结构化测算结果变成事实草稿、提示词与数字回查。
 * 不依赖 Cloudflare 运行时，方便用 Node 直接测试。 */

const FORMATTER = new Intl.NumberFormat("zh-CN");

function fmtInt(value) {
  return FORMATTER.format(Math.round(Number(value)));
}

function fmtPct(value) {
  return Number(value).toFixed(1) + "%";
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "payload 必须是对象";
  if (!payload.city) return "缺少 city";
  if (!payload.inputs || typeof payload.inputs !== "object") return "缺少 inputs";
  if (!Array.isArray(payload.scenarios) || payload.scenarios.length === 0)
    return "缺少 scenarios";

  const required = [
    "base_daily_orders",
    "traditional_fleet",
    "traditional_daily_orders_per_vehicle",
    "robotaxi_daily_orders_per_vehicle",
  ];
  for (const key of required) {
    if (!(Number(payload.inputs[key]) > 0)) return `inputs.${key} 必须为正数`;
  }
  for (const s of payload.scenarios) {
    const p = Number(s.pressure);
    if (!(p >= 0 && p <= 1)) return "scenario.pressure 必须在 [0, 1]";
    if (!(Number(s.robotaxi_needed) >= 0)) return "scenario.robotaxi_needed 非法";
  }
  return null;
}

function buildDraft(payload) {
  const inputs = payload.inputs;
  const lines = [];
  lines.push("【" + payload.city + " · Robotaxi 车队规模情景测算】");
  lines.push(
    "以日均订单 " +
      fmtInt(inputs.base_daily_orders) +
      " 单、传统车队 " +
      fmtInt(inputs.traditional_fleet) +
      " 辆、单车日均订单 " +
      Number(inputs.traditional_daily_orders_per_vehicle).toFixed(2) +
      " 单为基准："
  );
  for (const s of payload.scenarios) {
    lines.push(
      "· 订单压力 " +
        fmtPct(Number(s.pressure) * 100) +
        "：需新增 Robotaxi " +
        fmtInt(s.robotaxi_needed) +
        " 辆；传统车队剩余 " +
        fmtInt(s.traditional_fleet_after) +
        " 辆，降幅 " +
        fmtPct(s.traditional_reduction_pct) +
        "。"
    );
  }
  lines.push(
    "说明：净替代系数 " +
      Number(payload.net_substitution_ratio).toFixed(2) +
      "；结果为情景测算，不考虑诱导需求、政策许可与运营成本变化，不构成投资建议。"
  );
  if (inputs.as_of) lines.push("数据截至：" + inputs.as_of + "。");
  if (inputs.note) lines.push("口径：" + inputs.note);
  return lines.join("\n");
}

function buildAllowedNumbers(payload) {
  const allowed = new Set();
  const add = (value) => {
    if (value == null) return;
    const text = String(value);
    allowed.add(text);
    allowed.add(text.replace(/,/g, ""));
    const num = Number(text.replace(/,/g, ""));
    if (Number.isFinite(num)) {
      // 草稿里会用 toFixed(1)/(2)，把等价写法也放行
      allowed.add(num.toFixed(1));
      allowed.add(num.toFixed(2));
    }
  };

  const walk = (node) => {
    if (node == null) return;
    if (typeof node === "number") {
      add(node);
      return;
    }
    if (typeof node === "string") {
      const matches = node.match(/\d[\d,]*(?:\.\d+)?/g) || [];
      matches.forEach(add);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };

  walk(payload);
  (payload.scenarios || []).forEach((s) => {
    add(Math.round(Number(s.pressure) * 100));
    add(Number(s.pressure * 100).toFixed(1));
  });
  // 常见常量：百分比基数、论文校准比例、小的计数词
  [100, 0.27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].forEach(add);
  return allowed;
}

function extractNumbers(text) {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let match;
  while ((match = re.exec(text)) !== null) out.push(match[0]);
  return out;
}

function validateNumbers(text, allowed) {
  const invalid = [];
  for (const token of extractNumbers(text)) {
    const normalized = token.replace(/,/g, "");
    if (allowed.has(token) || allowed.has(normalized)) continue;
    // 允许 0–10 的小整数，避免“1–2 个”这类措辞误报
    if (/^\d+$/.test(normalized)) {
      const n = Number(normalized);
      if (n >= 0 && n <= 10) continue;
    }
    invalid.push(token);
  }
  return { ok: invalid.length === 0, invalid };
}

function buildMessages(payload, draft) {
  const system = [
    "你是一名严谨的行业研究员。请把给定的测算草稿改写成结构清晰的中文分析简报。",
    "硬性规则：",
    "1. 只能使用草稿中已经出现的数字，绝不新增、修改或推测任何数字；",
    "2. 不要给出投资建议，也不要下“应该入局”的结论；",
    "3. 明确这是情景测算，并指出关键假设与局限；",
    "4. 输出四段：结论摘要、关键数字、驱动因素、风险与局限；每段一句话或短段落，不使用 Markdown 表格。",
  ].join("\n");

  return [
    { role: "system", content: system },
    {
      role: "user",
      content:
        "以下是事实与草稿：\n" +
        draft +
        "\n\n请在不改变任何数字的前提下改写，并保留“情景测算、非预测”的限定。",
    },
  ];
}




const RATE_LIMIT = 20;
const RATE_WINDOW = 60 * 60 * 1000;
const CACHE_TTL = 10 * 60 * 1000;

const hits = new Map();
const memoCache = new Map();

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowed.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8" },
      extra || {}
    ),
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  if (arr.length >= RATE_LIMIT) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 2000) {
    for (const [key, value] of hits) {
      if (!value.some((t) => now - t < RATE_WINDOW)) hits.delete(key);
    }
  }
  return false;
}

async function callDeepSeek(env, messages) {
  const base = String(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(
    /\/$/,
    ""
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.DEEPSEEK_API_KEY,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || "deepseek-chat",
        messages,
        temperature: 0.3,
        max_tokens: 800,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        "DeepSeek HTTP " + res.status + (text ? ": " + text.slice(0, 200) : "")
      );
    }
    const data = await res.json();
    const content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    if (!content) throw new Error("DeepSeek 返回为空");
    return {
      text: String(content).trim(),
      model: data.model || env.DEEPSEEK_MODEL || "deepseek-chat",
    };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
      return json(
        {
          ok: true,
          service: "robotaxi-memo",
          endpoint: "POST /api/memo",
          hasKey: Boolean(env.DEEPSEEK_API_KEY),
          model: env.DEEPSEEK_MODEL || "deepseek-chat",
        },
        200,
        cors
      );
    }

    if (request.method !== "POST" || !url.pathname.endsWith("/api/memo")) {
      return json({ error: "not_found" }, 404, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return json(
        { error: "rate_limited", detail: "每小时最多 " + RATE_LIMIT + " 次" },
        429,
        cors
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }

    const problem = validatePayload(payload);
    if (problem) {
      return json({ error: "invalid_payload", detail: problem }, 400, cors);
    }

    const draft = buildDraft(payload);
    const cacheKey = JSON.stringify(payload);
    const cached = memoCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return json(
        { memo: cached.memo, model: cached.model, fallback: false, cached: true },
        200,
        cors
      );
    }

    if (!env.DEEPSEEK_API_KEY) {
      return json(
        { memo: draft, model: "local-fallback", fallback: true, reason: "missing_key" },
        200,
        cors
      );
    }

    try {
      const { text, model } = await callDeepSeek(
        env,
        buildMessages(payload, draft)
      );
      const allowed = buildAllowedNumbers(payload);
      const check = validateNumbers(text, allowed);
      if (!check.ok) {
        return json(
          {
            memo: draft,
            model: "local-fallback",
            fallback: true,
            reason: "number_mismatch",
            invalid: check.invalid,
          },
          200,
          cors
        );
      }

      memoCache.set(cacheKey, {
        expires: Date.now() + CACHE_TTL,
        memo: text,
        model,
      });
      if (memoCache.size > 200) {
        const now = Date.now();
        for (const [key, value] of memoCache) {
          if (value.expires <= now) memoCache.delete(key);
        }
      }
      return json({ memo: text, model, fallback: false }, 200, cors);
    } catch (err) {
      return json(
        {
          memo: draft,
          model: "local-fallback",
          fallback: true,
          reason: String((err && err.message) || err),
        },
        200,
        cors
      );
    }
  },
};
