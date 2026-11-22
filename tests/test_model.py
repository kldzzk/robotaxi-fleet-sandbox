"""核心模型与评分的单元测试。

运行：
    python -m unittest discover -s tests -v
或：
    python -m pytest -q
"""

from __future__ import annotations

import unittest

from robotaxi_fleet.model import (
    CityPreset,
    ModelInputError,
    analyze,
)
from robotaxi_fleet.presets import get_preset, load_presets
from robotaxi_fleet.scoring import DEFAULT_WEIGHTS, score


def paper_preset() -> CityPreset:
    return CityPreset(
        key="paper_baseline",
        name="论文标定基准",
        population=None,
        base_daily_orders=942000,
        traditional_fleet=47100,
        traditional_daily_orders_per_vehicle=20,
        robotaxi_daily_orders_per_vehicle=20,
    )


class TestPaperReproduction(unittest.TestCase):
    def test_reproduces_headline_numbers(self) -> None:
        result = analyze(paper_preset(), (0.05, 0.10, 0.20))
        needed = [s.robotaxi_needed for s in result.scenarios]
        self.assertEqual(needed, [2355, 4710, 9420])

    def test_traditional_reduction_matches_pressure(self) -> None:
        result = analyze(paper_preset(), (0.05, 0.10, 0.20))
        reductions = [round(s.traditional_reduction_pct, 1) for s in result.scenarios]
        self.assertEqual(reductions, [5.0, 10.0, 20.0])

    def test_preset_fleet_is_consistent(self) -> None:
        p = paper_preset()
        self.assertAlmostEqual(
            p.base_daily_orders / p.traditional_daily_orders_per_vehicle,
            p.traditional_fleet,
        )


class TestScenarios(unittest.TestCase):
    def test_linear_scaling(self) -> None:
        result = analyze(paper_preset(), (0.10,))
        baseline = analyze(paper_preset(), (0.05,))
        self.assertEqual(
            result.scenarios[0].robotaxi_needed,
            baseline.scenarios[0].robotaxi_needed * 2,
        )

    def test_net_substitution_ratio_scales_orders(self) -> None:
        result = analyze(paper_preset(), (0.10,), net_substitution_ratio=0.5)
        scenario = result.scenarios[0]
        self.assertAlmostEqual(scenario.effective_pressure, 0.05)
        # 942000 * 0.05 / 20 = 2355
        self.assertEqual(scenario.robotaxi_needed, 2355)

    def test_zero_pressure_gives_zero_robotaxi(self) -> None:
        result = analyze(paper_preset(), (0.0,))
        self.assertEqual(result.scenarios[0].robotaxi_needed, 0)
        self.assertEqual(result.scenarios[0].traditional_reduction_pct, 0.0)

    def test_invalid_pressure_raises(self) -> None:
        with self.assertRaises(ModelInputError):
            analyze(paper_preset(), (1.5,))

    def test_invalid_net_ratio_raises(self) -> None:
        with self.assertRaises(ModelInputError):
            analyze(paper_preset(), (0.1,), net_substitution_ratio=0)

    def test_invalid_preset_raises(self) -> None:
        bad = CityPreset(
            key="bad",
            name="bad",
            population=None,
            base_daily_orders=0,
            traditional_fleet=1,
            traditional_daily_orders_per_vehicle=1,
            robotaxi_daily_orders_per_vehicle=1,
        )
        with self.assertRaises(ModelInputError):
            analyze(bad, (0.1,))

    def test_to_dict_roundtrip_shape(self) -> None:
        payload = analyze(paper_preset(), (0.05,)).to_dict()
        self.assertIn("assumptions", payload)
        self.assertEqual(payload["scenarios"][0]["robotaxi_needed"], 2355)


class TestPresets(unittest.TestCase):
    def test_loads_bundled_presets(self) -> None:
        presets = load_presets()
        self.assertIn("paper_baseline", presets)
        self.assertGreaterEqual(len(presets), 2)

    def test_get_unknown_preset_raises(self) -> None:
        with self.assertRaises(LookupError):
            get_preset("does_not_exist")

    def test_bundled_paper_baseline_reproduces(self) -> None:
        result = analyze(get_preset("paper_baseline"), (0.05, 0.10, 0.20))
        self.assertEqual(
            [s.robotaxi_needed for s in result.scenarios],
            [2355, 4710, 9420],
        )


class TestRealPresets(unittest.TestCase):
    REAL_KEYS = {"guangzhou", "wuhan", "chengdu", "hangzhou", "mianyang"}

    def test_real_cities_present(self) -> None:
        presets = load_presets()
        self.assertTrue(self.REAL_KEYS.issubset(presets))

    def test_real_presets_are_self_consistent(self) -> None:
        for key in self.REAL_KEYS:
            preset = get_preset(key)
            implied = (
                preset.base_daily_orders
                / preset.traditional_daily_orders_per_vehicle
            )
            self.assertAlmostEqual(
                implied / preset.traditional_fleet, 1.0, delta=0.01, msg=key
            )

    def test_analysis_runs_for_each_real_city(self) -> None:
        for key in self.REAL_KEYS:
            result = analyze(get_preset(key), (0.05, 0.10, 0.20))
            self.assertEqual(len(result.scenarios), 3)
            self.assertTrue(
                all(s.robotaxi_needed >= 0 for s in result.scenarios), msg=key
            )


class TestScoring(unittest.TestCase):
    def test_score_within_range_and_has_band(self) -> None:
        result = score({k: 60 for k in DEFAULT_WEIGHTS})
        self.assertEqual(result["score"], 60.0)
        self.assertIn(result["band"], {"观望", "谨慎试点", "积极布局", "重点投入"})

    def test_missing_metrics_default_to_fifty(self) -> None:
        result = score({})
        self.assertEqual(result["score"], 50.0)

    def test_out_of_range_metric_raises(self) -> None:
        with self.assertRaises(ValueError):
            score({"policy_openness": 120})

    def test_high_scores_hit_top_band(self) -> None:
        result = score({k: 95 for k in DEFAULT_WEIGHTS})
        self.assertEqual(result["band"], "重点投入")


if __name__ == "__main__":
    unittest.main()
