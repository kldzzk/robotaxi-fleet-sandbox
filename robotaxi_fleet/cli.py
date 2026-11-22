"""命令行入口：python -m robotaxi_fleet ..."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .model import DEFAULT_PRESSURES, ModelInputError, analyze
from .presets import PresetError, get_preset, load_presets
from .report import to_markdown
from .scoring import from_preset


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="robotaxi",
        description="Robotaxi 车队规模情景分析（确定性计算，不是预测）。",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="列出可用城市预设")
    p_list.add_argument("--data", help="自定义 cities.json 路径")

    p_analyze = sub.add_parser("analyze", help="按情景压力测算车队规模")
    p_analyze.add_argument("--city", default="paper_baseline", help="城市预设 key")
    p_analyze.add_argument(
        "--pressures",
        nargs="+",
        type=float,
        default=list(DEFAULT_PRESSURES),
        help="情景压力，默认 0.05 0.10 0.20",
    )
    p_analyze.add_argument(
        "--net-ratio",
        type=float,
        default=1.0,
        help="净替代系数，默认 1.0（直接复现论文口径）",
    )
    p_analyze.add_argument("--score", action="store_true", help="附加入局窗口评分")
    p_analyze.add_argument("--json", action="store_true", help="输出 JSON")
    p_analyze.add_argument("--out", help="写入文件（.md 或 .json）")
    p_analyze.add_argument("--data", help="自定义 cities.json 路径")

    p_score = sub.add_parser("score", help="只看入局窗口评分")
    p_score.add_argument("--city", default="paper_baseline", help="城市预设 key")
    p_score.add_argument("--json", action="store_true", help="输出 JSON")
    p_score.add_argument("--data", help="自定义 cities.json 路径")

    return parser


def _cmd_list(args: argparse.Namespace) -> int:
    presets = load_presets(args.data)
    for key, preset in sorted(presets.items()):
        print(f"{key:16s} {preset.name}")
    return 0


def _cmd_analyze(args: argparse.Namespace) -> int:
    preset = get_preset(args.city, args.data)
    analysis = analyze(preset, args.pressures, args.net_ratio)
    scoring_result = from_preset(preset.scoring) if args.score else None

    if args.json:
        payload = analysis.to_dict()
        if scoring_result is not None:
            payload["scoring"] = scoring_result
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = to_markdown(analysis, scoring_result)

    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"已写入 {args.out}")
    else:
        print(text)
    return 0


def _cmd_score(args: argparse.Namespace) -> int:
    preset = get_preset(args.city, args.data)
    result = from_preset(preset.scoring)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"{preset.name}：{result['score']:.1f} / 100（{result['band']}）")
        for row in result["criteria"]:
            print(f"  - {row['label']}: {row['score']:.1f}（权重 {row['weight'] * 100:.0f}%）")
        print(f"> {result['disclaimer']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "list":
            return _cmd_list(args)
        if args.command == "analyze":
            return _cmd_analyze(args)
        if args.command == "score":
            return _cmd_score(args)
        parser.error("未知命令")
        return 2
    except (ModelInputError, PresetError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
