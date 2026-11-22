const assert = require("node:assert");
const { analyze } = require("../web/model.js");

const paper = {
  base_daily_orders: 942000,
  traditional_fleet: 47100,
  traditional_daily_orders_per_vehicle: 20,
  robotaxi_daily_orders_per_vehicle: 20,
};

const results = analyze(paper, [0.05, 0.1, 0.2], 1);
assert.deepStrictEqual(
  results.map((s) => s.robotaxi_needed),
  [2355, 4710, 9420],
  "应复现论文 2355/4710/9420"
);
assert.deepStrictEqual(
  results.map((s) => Math.round(s.traditional_reduction_pct)),
  [5, 10, 20],
  "传统车队降幅应等于情景压力"
);

const half = analyze(paper, [0.1], 0.5)[0];
assert.strictEqual(half.robotaxi_needed, 2355, "净替代 0.5 等价于 5% 压力");

assert.throws(() => analyze(paper, [1.5], 1), /情景压力/);
assert.throws(() => analyze(paper, [0.1], 0), /净替代系数/);

console.log("web model tests passed");
