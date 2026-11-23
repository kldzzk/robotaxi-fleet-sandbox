import assert from "node:assert";
import {
  buildAllowedNumbers,
  buildDraft,
  buildMessages,
  validateNumbers,
  validatePayload,
} from "../src/memo.js";

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

assert.strictEqual(validatePayload(payload), null);
assert.ok(validatePayload({}), "空 payload 应返回错误信息");

const draft = buildDraft(payload);
assert.ok(draft.includes("2,355"), "草稿应包含 2,355");
assert.ok(draft.includes("4,710"), "草稿应包含 4,710");
assert.ok(draft.includes("9,420"), "草稿应包含 9,420");

const allowed = buildAllowedNumbers(payload);
assert.ok(validateNumbers(draft, allowed).ok, "草稿自身的数字应通过校验");

const bad = draft + " 预计还会新增 98,765 辆。";
const result = validateNumbers(bad, allowed);
assert.ok(!result.ok, "编造数字应被拦截");
assert.ok(result.invalid.includes("98,765"), "应报告被拦截的数字");

const messages = buildMessages(payload, draft);
assert.strictEqual(messages.length, 2);
assert.ok(messages[0].content.includes("绝不新增"), "系统提示应包含数字约束");

console.log("worker memo tests passed");
