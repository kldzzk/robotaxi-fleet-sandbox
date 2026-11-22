"""Robotaxi 车队规模情景分析工具。"""

from .model import (
    DEFAULT_PRESSURES,
    PAPER_SUBSTITUTION_RATIO,
    Analysis,
    CityPreset,
    ModelInputError,
    Scenario,
    analyze,
)
from .presets import get_preset, load_presets
from .scoring import score

__all__ = [
    "Analysis",
    "CityPreset",
    "DEFAULT_PRESSURES",
    "ModelInputError",
    "PAPER_SUBSTITUTION_RATIO",
    "Scenario",
    "analyze",
    "get_preset",
    "load_presets",
    "score",
]

__version__ = "0.1.0"
