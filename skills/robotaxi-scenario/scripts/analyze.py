#!/usr/bin/env python3
"""一行命令生成 Robotaxi 车队规模情景报告。

示例：
    python skills/robotaxi-scenario/scripts/analyze.py --list
    python skills/robotaxi-scenario/scripts/analyze.py --city wuhan --pressures 0.05 0.1 0.2
    python skills/robotaxi-scenario/scripts/analyze.py --city paper_baseline --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def _bootstrap() -> None:
    """把仓库根目录加入 sys.path；也支持已安装的 robotaxi_fleet。"""
    candidates = []
    env = os.environ.get("ROBOTAXI_REPO")
    if env:
        candidates.append(Path(env))
    # repo/skills/robotaxi-scenario/scripts/analyze.py -> parents[3] = repo root
    candidates.append(Path(__file__).resolve().parents[3])
    candidates.append(Path.cwd())

    for candidate in candidates:
        if (candidate / "robotaxi_fleet").is_dir():
            sys.path.insert(0, str(candidate))
            return

    try:  # 已 pip install 的情况
        import robotaxi_fleet  # noqa: F401
    except ImportError:
        sys.exit(
            "找不到 robotaxi_fleet。请在仓库根目录运行，"
            "或设置 ROBOTAXI_REPO 指向仓库根目录，或先 pip install -e ."
        )


_bootstrap()

from robotaxi_fleet.model import DEFAULT_PRESSURES, ModelInputError, analyze  # noqa: E402
from robotaxi_fleet.presets import PresetError, get_preset, load_presets  # noqa: E402
from robotaxi_fleet.report import to_markdown  # noqa: E402
from robotaxi_fleet.scoring import from_preset  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Robotaxi 车队规模情景分析")
    parser.add_argument("--city", default="paper_baseline", help="城市预设 key")
    parser.add_argument(
        "--pressures",
        nargs="+",
        type=float,
        default=list(DEFAULT_PRESSURES),
        help="情景压力，默认 0.05 0.10 0.20",
    )
    parser.add_argument(
        "--net-ratio",
        type=float,
        default=1.0,
        help="净替代系数，默认 1.0（直接复现论文口径）",
    )
    parser.add_argument("--score", action="store_true", help="附加入局窗口评分")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--out", help="写入 Markdown/JSON 文件")
    parser.add_argument("--list", action="store_true", help="列出可用城市")
    parser.add_argument("--data", help="自定义 cities.json 路径")
    args = parser.parse_args(argv)

    try:
        if args.list:
            for key, preset in sorted(load_presets(args.data).items()):
                print(f"{key:16s} {preset.name}")
            return 0

        preset = get_preset(args.city, args.data)
        analysis = analyze(preset, args.pressures, args.net_ratio)
        scoring = from_preset(preset.scoring) if args.score else None

        if args.json:
            payload = analysis.to_dict()
            if scoring:
                payload["scoring"] = scoring
            text = json.dumps(payload, ensure_ascii=False, indent=2)
        else:
            text = to_markdown(analysis, scoring)

        if args.out:
            Path(args.out).write_text(text + "\n", encoding="utf-8")
            print(f"已写入 {args.out}")
        else:
            print(text)
        return 0
    except (ModelInputError, PresetError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
