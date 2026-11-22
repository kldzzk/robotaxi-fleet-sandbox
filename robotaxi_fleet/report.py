"""把分析结果渲染为 Markdown 报告。"""

from __future__ import annotations

from .model import Analysis, CityPreset
from .scoring import CRITERIA_LABELS


def _int(value: float | int) -> str:
    return f"{int(round(value)):,}"


def _num(value: float) -> str:
    return f"{value:,.1f}"


def _pct(value: float) -> str:
    return f"{value:.1f}%"


def scenario_table(analysis: Analysis) -> str:
    lines = [
        "| 情景压力 | 被替代订单/日 | 需新增 Robotaxi | 传统车队剩余 | 传统车队降幅 |",
        "|---:|---:|---:|---:|---:|",
    ]
    for s in analysis.scenarios:
        lines.append(
            "| {p} | {orders} | {cars} 辆 | {fleet} 辆 | {reduction} |".format(
                p=_pct(s.pressure * 100),
                orders=_int(s.substituted_orders),
                cars=_int(s.robotaxi_needed),
                fleet=_int(s.traditional_fleet_after),
                reduction=_pct(s.traditional_reduction_pct),
            )
        )
    return "\n".join(lines)


def scoring_table(result: dict) -> str:
    lines = [
        "| 维度 | 得分 | 权重 |",
        "|---|---:|---:|",
    ]
    for row in result["criteria"]:
        lines.append(
            f"| {row['label']} | {row['score']:.1f} | {row['weight'] * 100:.0f}% |"
        )
    lines.append(f"| **加权总分** | **{result['score']:.1f}** | "
                 f"**{result['band']}** |")
    return "\n".join(lines)


def assumptions_block(preset: CityPreset, net_ratio: float) -> str:
    pop = _int(preset.population) if preset.population else "未提供"
    return "\n".join(
        [
            f"- 城市人口：{pop}",
            f"- 日均订单：{_int(preset.base_daily_orders)} 单",
            f"- 传统车队规模：{_int(preset.traditional_fleet)} 辆",
            f"- 传统单车日均订单：{_num(preset.traditional_daily_orders_per_vehicle)} 单",
            f"- Robotaxi 单车日均订单：{_num(preset.robotaxi_daily_orders_per_vehicle)} 单",
            f"- 论文订单替代比例（参考）：{preset.substitution_ratio:.2f}",
            f"- 本次净替代系数：{net_ratio:.2f}",
        ]
    )


def to_markdown(analysis: Analysis, scoring_result: dict | None = None) -> str:
    preset = analysis.preset
    parts = [
        f"# {preset.name} · Robotaxi 车队规模情景分析",
        "",
        "> 本报告是**情景计算**，不是预测，也不构成投资建议。结论依赖下列假设。",
        "",
        "## 输入假设",
        "",
        assumptions_block(preset, analysis.net_substitution_ratio),
    ]
    if preset.note:
        parts.extend(["", f"> 数据说明：{preset.note}"])

    parts.extend(
        [
            "",
            "## 情景测算",
            "",
            scenario_table(analysis),
            "",
            "公式：需新增 Robotaxi = ceil(被替代订单 ÷ Robotaxi 单车日均订单)；"
            "被替代订单 = 日均订单 × 情景压力 × 净替代系数。",
        ]
    )

    if scoring_result is not None:
        parts.extend(
            [
                "",
                "## 入局窗口评分（启发式）",
                "",
                scoring_table(scoring_result),
                "",
                f"> {scoring_result['disclaimer']}",
            ]
        )

    parts.extend(
        [
            "",
            "## 风险与局限",
            "",
            "- 需求并非线性：低价或供给增加可能诱导新增出行，实际替代量可能偏离。",
            "- 单车日均订单、利用率与运营半径会随城市与政策变化，需用本地数据校准。",
            "- 政策许可、事故责任、充电/维护成本等未在模型中内生。",
            "- 0.27 为论文校准参数，本工具默认视为已内化进情景压力。",
            "",
            "---",
            "",
            "由 `robotaxi-fleet-sandbox` 生成。",
        ]
    )
    return "\n".join(parts)


def criteria_help() -> str:
    return "\n".join(f"- `{key}`：{label}" for key, label in CRITERIA_LABELS.items())
