# 方法论与假设

## 1. 目的

给定一个城市的订单与车队参数，测算在不同「订单压力」情景下：

1. 需要新增多少辆 Robotaxi；
2. 传统出租车 / 网约车车队会被挤压到什么规模；
3. 在若干定性维度上，入局窗口的相对位置（启发式评分）。

模型刻意保持简单透明：**每个数字都能从输入直接复算**，便于讨论与替换假设。

## 2. 变量

| 变量 | 含义 | 单位 |
|---|---|---|
| `base_daily_orders` | 城市日均出行订单 | 单/日 |
| `traditional_fleet` | 传统出租车 + 网约车规模 | 辆 |
| `traditional_daily_orders_per_vehicle` | 传统车单车日均订单 | 单/日/辆 |
| `robotaxi_daily_orders_per_vehicle` | Robotaxi 单车日均订单 | 单/日/辆 |
| `pressure` | 情景订单压力（订单转移到 Robotaxi 的比例） | 0–1 |
| `net_substitution_ratio` | 净替代系数（默认 1.0） | 0–1 |
| `substitution_ratio` | 论文校准的订单替代比例（参考值 0.27） | 0–1 |

## 3. 公式

```
effective_pressure = pressure × net_substitution_ratio
substituted_orders = base_daily_orders × effective_pressure
robotaxi_needed    = ceil(substituted_orders ÷ robotaxi_daily_orders_per_vehicle)

traditional_orders_after = base_daily_orders − substituted_orders
traditional_fleet_after  = traditional_orders_after ÷ traditional_daily_orders_per_vehicle
traditional_reduction    = (traditional_fleet − traditional_fleet_after) ÷ traditional_fleet
```

当 `traditional_fleet = base_daily_orders ÷ traditional_daily_orders_per_vehicle`
（即基准处于满负荷）时，传统车队降幅恰好等于 `effective_pressure`。

## 4. 复现检查

`data/cities.json` 中的 `paper_baseline` 预设：

- 日均订单 942,000
- 传统车队 47,100（= 942,000 ÷ 20）
- 传统 / Robotaxi 单车日均订单 20
- 净替代系数 1.0

代入后：

| 压力 | 被替代订单 | Robotaxi | 传统车队剩余 | 降幅 |
|---:|---:|---:|---:|---:|
| 5% | 47,100 | 2,355 | 44,745 | 5% |
| 10% | 94,200 | 4,710 | 42,390 | 10% |
| 20% | 188,400 | 9,420 | 37,680 | 20% |

与论文中 5%/10%/20% 对应 2,355/4,710/9,420 辆的口径一致。
`tests/test_model.py` 对此有自动断言。

## 5. 关于 0.27

论文用 Liao 等（2027）需求模型校准出「订单替代比例约 0.27」。
本工具**默认把这个比例视为已经内化进情景压力**，因此基础公式里不再乘一次，
以免重复折算导致结果与论文不一致。

如果你想演示「只按 0.27 折算」的敏感性视图，可设置：

```bash
python -m robotaxi_fleet analyze --city paper_baseline --net-ratio 0.27
```

此时有效压力 = 情景压力 × 0.27，结果会相应缩小——这是**另一种口径**，需在报告中注明。

## 6. 假设与局限

- **线性替代**：假设订单按比例转移，未考虑低价诱导的新增出行。
- **单车产能固定**：未内生拥堵、空驶率、运营时段与充电时间。
- **静态均衡**：不考虑平台补贴、价格战与监管变化的动态反馈。
- **政策外生**：许可、事故责任、路权等不在模型内。
- **评分主观**：入局窗口评分是启发式权重，不能替代尽调。

## 7. 如何扩展

- 在 `data/cities.json` 增加真实城市口径；
- 在 `robotaxi_fleet/model.py` 增加新的情景函数（如诱导需求、单位经济性）；
- 网页层复用 `analysis.to_dict()` 作为前后端契约；
- AI 简报层只读取该 JSON，保证数字全部来自计算。

## 8. 参考

- Liao 等（2027）需求模型（订单替代比例约 0.27 的校准来源）。
- 作者关于萝卜快跑的行业研究论文（情景预警模型与 256 城面板）。
