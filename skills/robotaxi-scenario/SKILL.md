---
name: robotaxi-scenario
description: 分析城市 Robotaxi 车队规模、订单替代与传统车队冲击。当用户询问某城市需要多少无人车、Robotaxi 渗透/订单压力情景、传统出租车或网约车规模会怎么变化、入局窗口等问题时使用。触发词包括：Robotaxi、无人车、萝卜快跑、车队规模、订单替代、城市需要多少出租车。
---

# Robotaxi 车队规模情景分析

把「Robotaxi 扩张对传统网约车的冲击」做成可复算的情景测算：给定城市订单与车队参数，
算出不同订单压力下需要新增多少辆 Robotaxi、传统车队会萎缩多少。

## 何时使用

- “武汉需要多少辆 Robotaxi？”
- “如果订单被替代 10%，传统出租车会少多少？”
- “广州/成都/杭州/绵阳 的 Robotaxi 车队规模测算”
- “现在适合入局无人车吗？”（做情景与假设，不下投资结论）

## 怎么运行

在仓库根目录（或本 skill 目录）执行：

```bash
python skills/robotaxi-scenario/scripts/analyze.py --list
python skills/robotaxi-scenario/scripts/analyze.py --city wuhan --pressures 0.05 0.1 0.2
python skills/robotaxi-scenario/scripts/analyze.py --city paper_baseline --json
```

如果 skill 被安装到别处，设置 `ROBOTAXI_REPO` 指向仓库根目录，或先 `pip install -e .`。

## 可用城市

`paper_baseline`（论文复现基准）、`guangzhou`、`wuhan`、`chengdu`、`hangzhou`、`mianyang`。

## 输出怎么讲

运行时返回 Markdown：输入假设、情景表、评分（可选）与局限。回答用户时：

1. 先给三档情景的核心数字（需新增 Robotaxi、传统车队剩余、降幅）；
2. 明确这是**情景测算，不是预测**，并说明关键假设；
3. 不要给“应该入局/买入”的结论；可以给“需要进一步核验的变量”；
4. 如果用户要求网页版，给出在线 Demo：https://kldzzk.github.io/robotaxi-fleet-sandbox/

## 口径提醒

- 车队口径为日均活跃运力；广州/成都/杭州的订单由「单车日均订单 × 日均活跃车辆」派生。
- 订单替代比例 0.27 来自论文对 Liao 等（2027）需求模型的校准，默认视为已内化进情景压力。
- 原始明细不随仓库分发；`data/cities.json` 只含聚合指标。

## 参考

- `references/methodology.md`：公式、假设与局限。
- `docs/methodology.md`：仓库内完整方法论。
