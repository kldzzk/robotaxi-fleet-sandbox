import {
  buildAllowedNumbers,
  buildDraft,
  buildMessages,
  validateNumbers,
  validatePayload,
} from "./memo.js";

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
