# Robotaxi Fleet Sandbox · 无人车车队规模情景沙盘

把「Robotaxi 扩张对传统网约车的冲击」做成一个**透明、可复算、可交互**的情景分析工具。
调整城市订单与替代比例，即可看到需要新增多少辆无人车、传统车队会被挤压多少。

> 这是一个**情景计算器**，不是预测器，也不构成投资建议。所有结论都依赖页面中列出的假设。

## 当前进度

- [x] 确定性核心模型（纯标准库，可复现论文口径）
- [x] 命令行工具（`list / analyze / score`）
- [x] 单元测试（17 项，含论文数字复现）
- [ ] 静态交互网页 + 图表（下一步）
- [ ] Cloudflare Worker + DeepSeek 生成分析简报
- [ ] Claude Code Skill 封装
- [ ] GitHub Pages 部署

## 快速开始

```bash
# 列出可用城市预设
python -m robotaxi_fleet list

# 复现论文口径：5%/10%/20% 订单压力 → 2355/4710/9420 辆 Robotaxi
python -m robotaxi_fleet analyze --city paper_baseline --score

# 导出 JSON / Markdown
python -m robotaxi_fleet analyze --city guangzhou --pressures 0.05 0.1 0.2 --json --out report.json
python -m robotaxi_fleet analyze --city paper_baseline --score --out report.md

# 只看入局窗口评分
python -m robotaxi_fleet score --city demo_large

# 运行测试
python -m unittest discover -s tests -v
```

无需安装第三方依赖，Python ≥ 3.10 即可运行。

## 复现结果

`paper_baseline` 预设用于验证模型与论文口径一致：

| 情景压力 | 被替代订单/日 | 需新增 Robotaxi | 传统车队剩余 | 传统车队降幅 |
|---:|---:|---:|---:|---:|
| 5.0% | 47,100 | 2,355 辆 | 44,745 辆 | 5.0% |
| 10.0% | 94,200 | 4,710 辆 | 42,390 辆 | 10.0% |
| 20.0% | 188,400 | 9,420 辆 | 37,680 辆 | 20.0% |

完整示例见 [`examples/paper_baseline.md`](examples/paper_baseline.md)。

## 真实城市预设

除 `paper_baseline` 外，仓库内置 5 个由地方政府网约车月报聚合的城市（最近 6 个月中位数，
车队口径为日均活跃运力）：

| key | 城市 | 日均订单 | 传统车队 | 单车日均订单 | 数据截至 |
|---|---|---:|---:|---:|---|
| `guangzhou` | 广州 | 1,389,454 | 103,305 | 13.45 | 2026-06 |
| `wuhan` | 武汉 | 256,500 | 20,602 | 12.45 | 2025-12 |
| `chengdu` | 成都 | 1,180,044 | 77,994 | 15.13 | 2025-06 |
| `hangzhou` | 杭州 | 1,448,352 | 91,668 | 15.80 | 2026-07 |
| `mianyang` | 绵阳 | 130,608 | 7,220 | 18.09 | 2026-05 |

- 广州、成都、杭州的订单由「单车日均订单 × 日均活跃车辆」派生；武汉、绵阳为直接口径。
- 保守假设：Robotaxi 单车日均订单 = 传统车单车日均订单。
- 原始明细不随仓库分发；`scripts/build_cities.py` 可基于本地数据重新聚合。

## 模型

```
被替代订单      = 城市日均订单 × 情景压力 × 净替代系数
需新增 Robotaxi = ceil(被替代订单 ÷ Robotaxi 单车日均订单)
传统车队剩余    = (日均订单 − 被替代订单) ÷ 传统单车日均订单
传统车队降幅    = (原车队 − 剩余车队) ÷ 原车队
```

- 订单替代比例 **0.27** 来自论文对 Liao 等（2027）需求模型的校准，默认视为已内化进情景压力，避免重复折算。
- `--net-ratio` 可切换「仅按校准比例折算」的敏感性视图（默认 1.0）。
- 入局窗口评分为启发式，仅用于把政策、成本、竞争等因素放到同一张表里对齐口径。

详见 [`docs/methodology.md`](docs/methodology.md)。

## 目录结构

```
robotaxi-fleet-sandbox/
├─ robotaxi_fleet/     # 核心包
│  ├─ model.py         # 确定性模型
│  ├─ scoring.py       # 入局窗口评分
│  ├─ presets.py       # 预设加载
│  ├─ report.py        # Markdown 报告
│  └─ cli.py           # 命令行
├─ data/cities.json    # 城市预设（示例/复现参数）
├─ tests/              # 单元测试
├─ examples/           # 示例输出
├─ docs/               # 方法论与假设
└─ .github/workflows/  # CI
```

## 数据说明

`data/cities.json` 只放**聚合后的派生指标**，原始明细不随仓库分发。
聚合脚本见 `scripts/build_cities.py`（需要 pandas / openpyxl，仅开发用）：

```bash
python scripts/build_cities.py --source "你的原始数据目录"
```

**不要**提交 CEIC / EPS 等付费数据库的原始数据，也不要提交政府明细数据。
详见 [`data/README.md`](data/README.md)。

## 路线图

1. **网页**：城市选择 + 滑块 + 情景柱状图 + 敏感性热力图，部署到 GitHub Pages。
2. **AI 简报**：Cloudflare Worker 代理 + DeepSeek，数字由代码算，LLM 只负责叙述，带数字回查与降级。
3. **Skill**：`SKILL.md` + 脚本，本地一句话生成分析报告。

## 免责声明

本项目用于研究与演示，不构成任何投资、经营或入局建议。模型为高度简化的情景工具，
未内生政策许可、事故责任、充电与维护成本等因素，实际结果可能显著偏离。
