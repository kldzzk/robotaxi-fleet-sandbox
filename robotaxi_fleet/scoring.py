"""入局窗口评分卡（启发式）。

这不是投资建议，也不是预测模型。它把若干定性判断变成可讨论的评分，
方便在情景分析之外，把政策、成本、竞争等因素放在同一张表里对齐口径。

所有分数均为 0–100，权重之和会被归一化。默认权重只是占位，请按实际研究
口径调整。
"""

from __future__ import annotations

DEFAULT_WEIGHTS: dict[str, float] = {
    "policy_openness": 0.25,
    "cost_trend": 0.20,
    "order_pressure": 0.20,
    "competition": 0.15,
    "tech_maturity": 0.10,
    "data_availability": 0.10,
}

CRITERIA_LABELS: dict[str, str] = {
    "policy_openness": "政策开放度",
    "cost_trend": "成本下降趋势",
    "order_pressure": "订单压力（替代动力）",
    "competition": "竞争格局（越分散越高）",
    "tech_maturity": "技术成熟度",
    "data_availability": "数据可得性",
}

# 分数越高越积极；阈值为启发式，可调。
BANDS: tuple[tuple[float, str], ...] = (
    (80, "重点投入"),
    (60, "积极布局"),
    (40, "谨慎试点"),
    (0, "观望"),
)


class ScoringError(ValueError):
    """评分输入不合法时抛出。"""


def _band(score: float) -> str:
    for threshold, label in BANDS:
        if score >= threshold:
            return label
    return BANDS[-1][1]


def score(
    metrics: dict[str, float],
    weights: dict[str, float] | None = None,
) -> dict:
    """按权重计算入局窗口评分。

    Parameters
    ----------
    metrics : dict[str, float]
        各维度得分（0–100）。缺失维度默认 50。
    weights : dict[str, float] | None
        权重；缺省使用 DEFAULT_WEIGHTS。

    Returns
    -------
    dict
        包含总分、区间标签、各维度明细与免责声明。
    """

    weights = dict(weights or DEFAULT_WEIGHTS)
    total_weight = sum(weights.values())
    if total_weight <= 0:
        raise ScoringError("权重之和必须为正数")

    rows = []
    weighted_sum = 0.0
    for key, weight in weights.items():
        value = float(metrics.get(key, 50.0))
        if not 0 <= value <= 100:
            raise ScoringError(f"{key} 得分必须在 [0, 100]，收到 {value}")
        weighted_sum += value * weight
        rows.append(
            {
                "key": key,
                "label": CRITERIA_LABELS.get(key, key),
                "score": round(value, 1),
                "weight": round(weight / total_weight, 4),
            }
        )

    final = weighted_sum / total_weight
    return {
        "score": round(final, 1),
        "band": _band(final),
        "criteria": rows,
        "disclaimer": "启发式评分，权重与阈值可调，不构成投资或入局建议。",
    }


def from_preset(preset_scoring: dict[str, float]) -> dict:
    """用城市预设里预置的评分快速计算。"""

    return score(preset_scoring)
