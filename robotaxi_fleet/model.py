"""Robotaxi 车队规模情景分析——确定性核心模型。

设计原则
--------
1. 纯函数、只用标准库，任何数字都能从显式输入复算。
2. 模型是"情景计算器"，不是预测器；结论依赖假设，页面会明确标注。
3. 订单替代比例 0.27 来自论文对 Liao 等（2027）需求模型的校准，
   本工具默认把它视为已内化进情景压力中，避免重复折算。

核心公式
--------
被替代订单      = 城市日均订单 × 情景压力 × 净替代系数
需新增 Robotaxi = ceil(被替代订单 ÷ Robotaxi 单车日均订单)
传统车队剩余    = (日均订单 − 被替代订单) ÷ 传统单车日均订单
传统车队降幅    = (原车队 − 剩余车队) ÷ 原车队
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Sequence

DEFAULT_PRESSURES: tuple[float, ...] = (0.05, 0.10, 0.20)
PAPER_SUBSTITUTION_RATIO = 0.27


class ModelInputError(ValueError):
    """输入超出模型有效范围时抛出。"""


@dataclass(frozen=True)
class CityPreset:
    """一个城市的模型输入参数集合。"""

    key: str
    name: str
    population: int | None
    base_daily_orders: float
    traditional_fleet: float
    traditional_daily_orders_per_vehicle: float
    robotaxi_daily_orders_per_vehicle: float
    substitution_ratio: float = PAPER_SUBSTITUTION_RATIO
    note: str = ""
    scoring: dict[str, float] = field(default_factory=dict)

    def validate(self) -> None:
        if self.base_daily_orders <= 0:
            raise ModelInputError("base_daily_orders 必须为正数")
        if self.traditional_fleet <= 0:
            raise ModelInputError("traditional_fleet 必须为正数")
        if self.traditional_daily_orders_per_vehicle <= 0:
            raise ModelInputError("traditional_daily_orders_per_vehicle 必须为正数")
        if self.robotaxi_daily_orders_per_vehicle <= 0:
            raise ModelInputError("robotaxi_daily_orders_per_vehicle 必须为正数")
        if not 0 < self.substitution_ratio <= 1:
            raise ModelInputError("substitution_ratio 必须在 (0, 1] 区间")

    @classmethod
    def from_dict(cls, data: dict) -> "CityPreset":
        return cls(
            key=str(data["key"]),
            name=str(data["name"]),
            population=data.get("population"),
            base_daily_orders=float(data["base_daily_orders"]),
            traditional_fleet=float(data["traditional_fleet"]),
            traditional_daily_orders_per_vehicle=float(
                data["traditional_daily_orders_per_vehicle"]
            ),
            robotaxi_daily_orders_per_vehicle=float(
                data["robotaxi_daily_orders_per_vehicle"]
            ),
            substitution_ratio=float(
                data.get("substitution_ratio", PAPER_SUBSTITUTION_RATIO)
            ),
            note=str(data.get("note", "")),
            scoring={k: float(v) for k, v in (data.get("scoring") or {}).items()},
        )


@dataclass(frozen=True)
class Scenario:
    """单个情景压力下的测算结果。"""

    pressure: float
    effective_pressure: float
    substituted_orders: float
    robotaxi_needed: int
    traditional_orders_after: float
    traditional_fleet_after: int
    traditional_reduction_pct: float
    robotaxi_to_traditional_ratio: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class Analysis:
    """一次分析的完整结果。"""

    preset: CityPreset
    net_substitution_ratio: float
    scenarios: list[Scenario]

    def to_dict(self) -> dict:
        p = self.preset
        return {
            "city": p.name,
            "city_key": p.key,
            "net_substitution_ratio": self.net_substitution_ratio,
            "assumptions": {
                "base_daily_orders": p.base_daily_orders,
                "traditional_fleet": p.traditional_fleet,
                "traditional_daily_orders_per_vehicle": (
                    p.traditional_daily_orders_per_vehicle
                ),
                "robotaxi_daily_orders_per_vehicle": (
                    p.robotaxi_daily_orders_per_vehicle
                ),
                "substitution_ratio": p.substitution_ratio,
            },
            "scenarios": [s.to_dict() for s in self.scenarios],
        }


def _validate_pressure(pressure: float) -> float:
    pressure = float(pressure)
    if not 0 <= pressure <= 1:
        raise ModelInputError(f"情景压力必须在 [0, 1] 区间，收到 {pressure}")
    return pressure


def analyze(
    preset: CityPreset,
    pressures: Sequence[float] = DEFAULT_PRESSURES,
    net_substitution_ratio: float = 1.0,
) -> Analysis:
    """按给定情景压力测算 Robotaxi 新增规模与传统车队变化。

    Parameters
    ----------
    preset : CityPreset
        城市参数。
    pressures : Sequence[float]
        情景压力列表，例如 (0.05, 0.10, 0.20)。
    net_substitution_ratio : float
        净替代系数，默认 1.0（直接复现论文口径）。
        设为 0.27 可演示"仅按论文校准比例折算"的敏感性视图。
    """

    preset.validate()
    if not 0 < net_substitution_ratio <= 1:
        raise ModelInputError("net_substitution_ratio 必须在 (0, 1] 区间")
    if not pressures:
        raise ModelInputError("至少需要一个情景压力")

    scenarios: list[Scenario] = []
    for raw in pressures:
        pressure = _validate_pressure(raw)
        effective = pressure * net_substitution_ratio
        substituted = preset.base_daily_orders * effective
        needed = math.ceil(substituted / preset.robotaxi_daily_orders_per_vehicle)

        traditional_orders_after = max(preset.base_daily_orders - substituted, 0.0)
        traditional_fleet_after = (
            traditional_orders_after / preset.traditional_daily_orders_per_vehicle
        )
        reduction = (
            preset.traditional_fleet - traditional_fleet_after
        ) / preset.traditional_fleet
        ratio = (
            needed / traditional_fleet_after if traditional_fleet_after > 0 else math.inf
        )

        scenarios.append(
            Scenario(
                pressure=round(pressure, 6),
                effective_pressure=round(effective, 6),
                substituted_orders=round(substituted, 1),
                robotaxi_needed=needed,
                traditional_orders_after=round(traditional_orders_after, 1),
                traditional_fleet_after=int(round(traditional_fleet_after)),
                traditional_reduction_pct=round(reduction * 100, 2),
                robotaxi_to_traditional_ratio=(
                    round(ratio, 3) if math.isfinite(ratio) else ratio
                ),
            )
        )

    return Analysis(
        preset=preset,
        net_substitution_ratio=net_substitution_ratio,
        scenarios=scenarios,
    )
