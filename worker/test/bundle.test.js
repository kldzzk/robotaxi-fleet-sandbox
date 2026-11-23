import assert from "node:assert";
import worker from "../dist/worker.js";

const payload = {
  city: "论文标定基准（复现用）",
  inputs: {
    base_daily_orders: 942000,
    traditional_fleet: 47100,
    traditional_daily_orders_per_vehicle: 20,
    robotaxi_daily_orders_per_vehicle: 20,
    as_of: "",
    note: "用于复现论文口径",
  },
  net_substitution_ratio: 1,
  scenarios: [
    {
      pressure: 0.05,
      robotaxi_needed: 2355,
      traditional_fleet_after: 44745,
      traditional_reduction_pct: 5,
    },
    {
      pressure: 0.1,
      robotaxi_needed: 4710,
      traditional_fleet_after: 42390,
      traditional_reduction_pct: 10,
    },
    {
      pressure: 0.2,
      robotaxi_needed: 9420,
      traditional_fleet_after: 37680,
      traditional_reduction_pct: 20,
    },
  ],
};

// 健康检查
const health = await worker.fetch(new Request("https://example.com/"), {}, {});
assert.strictEqual(health.status, 200);
const healthData = await health.json();
assert.strictEqual(healthData.ok, true);
assert.strictEqual(healthData.hasKey, false);

// 没有 key -> 返回本地草稿
const res = await worker.fetch(
  new Request("https://example.com/api/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),
  {},
  {}
);
assert.strictEqual(res.status, 200);
const data = await res.json();
assert.strictEqual(data.fallback, true);
assert.strictEqual(data.reason, "missing_key");
assert.ok(data.memo.includes("2,355"), "草稿应包含 2,355");
assert.ok(data.memo.includes("9,420"), "草稿应包含 9,420");

// 非法 payload
const bad = await worker.fetch(
  new Request("https://example.com/api/memo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }),
  {},
  {}
);
assert.strictEqual(bad.status, 400);

console.log("worker bundle tests passed");
