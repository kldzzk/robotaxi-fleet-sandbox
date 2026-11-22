"""从本地采集的网约车月报数据聚合出 data/cities.json。

原始数据不随仓库分发；此脚本是开发工具，读取本地路径后只生成聚合指标。

用法：
    python scripts/build_cities.py --source "D:/萝卜快跑/data"

聚合规则：
- 每城取最近 6 个有效月，日均订单与单车日均订单分别取中位数；
- 车队 = 日均订单 ÷ 单车日均订单（隐含活跃运力），与模型自洽；
- 有活跃车辆字段的，订单可由「单车日均订单 × 日均活跃车辆」派生；
- 只在来源有可公开 URL 时写入 source_url，否则省略。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

WINDOW = 6

PAPER_BASELINE = {
    "key": "paper_baseline",
    "name": "论文标定基准（复现用）",
    "population": None,
    "base_daily_orders": 942000,
    "traditional_fleet": 47100,
    "traditional_daily_orders_per_vehicle": 20,
    "robotaxi_daily_orders_per_vehicle": 20,
    "substitution_ratio": 0.27,
    "as_of": "",
    "window": "",
    "derived_orders": False,
    "fleet_basis": "implied_active",
    "note": "用于复现论文中 5%/10%/20% 订单压力对应 2355/4710/9420 辆 Robotaxi 的口径。参数为拟合基准，非官方城市数据。",
}


def _num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _month(series: pd.Series) -> pd.Series:
    extracted = series.astype(str).str.extract(r"(\d+)")[0]
    return pd.to_numeric(extracted, errors="coerce")


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in ("year", "month", "per_vehicle", "daily_orders", "active"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["year", "month"])
    df["year"] = df["year"].astype(int)
    df["month"] = df["month"].astype(int)
    df = df[(df["month"] >= 1) & (df["month"] <= 12)]
    df = df[df["per_vehicle"] > 0]
    df["ym"] = df["year"].astype(str) + "-" + df["month"].astype(str).str.zfill(2)
    return df.sort_values(["year", "month"]).reset_index(drop=True)


def load_guangzhou(src: Path) -> pd.DataFrame:
    df = pd.read_csv(src / "广深月度监测/广州网约车监测数据.csv", encoding="utf-8-sig")
    per = _num(df["单车日均订单"])
    active_wan = _num(df["日均活跃网约车_万"])
    return _clean(
        pd.DataFrame(
            {
                "year": _num(df["年份"]),
                "month": _num(df["月份"]),
                "per_vehicle": per,
                "daily_orders": per * active_wan * 10000,
                "active": active_wan * 10000,
                "source_url": df.get("来源URL"),
            }
        )
    )


def load_wuhan(src: Path) -> pd.DataFrame:
    df = pd.read_csv(src / "武汉月度/武汉网约车月度_汇总.csv", encoding="utf-8-sig")
    return _clean(
        pd.DataFrame(
            {
                "year": _num(df["年份"]),
                "month": _num(df["月份"]),
                "per_vehicle": _num(df["单车日均订单"]),
                "daily_orders": _num(df["日均网约车订单总量_万单"]) * 10000,
                "active": None,
                "source_url": df.get("来源URL"),
            }
        )
    )


def load_chengdu(src: Path) -> pd.DataFrame:
    df = pd.read_csv(src / "成都月度/成都网约车月度数据.csv", encoding="utf-8-sig")
    per = _num(df["单车日均订单"])
    active_wan = _num(df["日均活跃车辆_万"])
    return _clean(
        pd.DataFrame(
            {
                "year": _num(df["年份"]),
                "month": _month(df["月份"]),
                "per_vehicle": per,
                "daily_orders": per * active_wan * 10000,
                "active": active_wan * 10000,
                "source_url": None,
            }
        )
    )


def load_hangzhou(src: Path) -> pd.DataFrame:
    df = pd.read_excel(src / "Hangzhou_month/杭州网约车月度数据.xlsx", sheet_name=0)
    df = df.rename(columns=lambda c: str(c).replace(" ", ""))
    # 年份写作「2024年」且只在每年首行出现，提取数字后向下填充
    year = _month(df["年份"]).ffill()
    month = _month(df["月份"])
    per = _num(df["单车日均订单"])
    active_wan = _num(df["日均活跃车辆_万"])
    return _clean(
        pd.DataFrame(
            {
                "year": year,
                "month": month,
                "per_vehicle": per,
                "daily_orders": per * active_wan * 10000,
                "active": active_wan * 10000,
                "source_url": None,
            }
        )
    )


def load_mianyang(src: Path) -> pd.DataFrame:
    df = pd.read_csv(src / "绵阳月度/绵阳网约车月度_汇总.csv", encoding="utf-8-sig")
    return _clean(
        pd.DataFrame(
            {
                "year": _num(df["年份"]),
                "month": _num(df["月份"]),
                "per_vehicle": _num(df["单车日均订单"]),
                "daily_orders": _num(df["日均网约车订单总量_万单"]) * 10000,
                "active": _num(df["日均活跃运力"]),
                "source_url": df.get("来源URL"),
            }
        )
    )


def finalize(
    key: str,
    name: str,
    df: pd.DataFrame,
    fleet_basis: str,
    derived_orders: bool,
    note: str,
) -> dict:
    df = df.copy()
    derived = df["per_vehicle"] * df["active"] * 10000
    df["row_orders"] = df["daily_orders"].where(df["daily_orders"].notna(), derived)
    df = df.dropna(subset=["row_orders"])
    df = df[df["row_orders"] > 0]
    if df.empty:
        raise ValueError("没有可用的订单/单车订单组合")

    window = df.tail(WINDOW)
    base = float(window["row_orders"].median())
    per = float(window["per_vehicle"].median())
    fleet = base / per
    urls = [
        str(u)
        for u in window["source_url"].dropna()
        if str(u).startswith("http")
    ]

    preset = {
        "key": key,
        "name": name,
        "population": None,
        "base_daily_orders": int(round(base)),
        "traditional_fleet": int(round(fleet)),
        "traditional_daily_orders_per_vehicle": round(per, 2),
        # 保守假设：Robotaxi 单车日均订单与传统车相同
        "robotaxi_daily_orders_per_vehicle": round(per, 2),
        "substitution_ratio": 0.27,
        "fleet_basis": fleet_basis,
        "as_of": window["ym"].iloc[-1],
        "window": f"最近{len(window)}个月中位数",
        "derived_orders": derived_orders,
        "note": note,
    }
    if urls:
        preset["source_url"] = urls[-1]
    return preset


LOADERS = [
    (
        "guangzhou",
        "广州",
        load_guangzhou,
        "active",
        True,
        "政府月报；订单由「单车日均订单 × 日均活跃车辆」派生。",
    ),
    (
        "wuhan",
        "武汉",
        load_wuhan,
        "implied_active",
        False,
        "36 期连续月度；订单与单车日均订单为直接口径，车队为隐含活跃运力（订单 ÷ 单车订单）。来源为依申请公开原表并经核验。",
    ),
    (
        "chengdu",
        "成都",
        load_chengdu,
        "active",
        True,
        "政府月报；订单由「单车日均订单 × 日均活跃车辆」派生（使用月度期）。",
    ),
    (
        "hangzhou",
        "杭州",
        load_hangzhou,
        "active",
        True,
        "月报；订单由「单车日均订单 × 日均活跃车辆」派生。",
    ),
    (
        "mianyang",
        "绵阳",
        load_mianyang,
        "active",
        False,
        "官方月报已核验；日均订单为全市口径，单车指标为城区口径；车队为日均活跃运力。",
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="聚合本地网约车月报为 cities.json")
    parser.add_argument("--source", default=r"D:/萝卜快跑/data", help="原始数据根目录")
    parser.add_argument("--out", default="data/cities.json", help="输出文件")
    args = parser.parse_args()

    src = Path(args.source)
    presets = [dict(PAPER_BASELINE)]

    for key, name, loader, fleet_basis, derived, note in LOADERS:
        try:
            df = loader(src)
            preset = finalize(key, name, df, fleet_basis, derived, note)
            presets.append(preset)
            print(
                f"OK  {name}: 日均订单={preset['base_daily_orders']:,} "
                f"车队={preset['traditional_fleet']:,} "
                f"单车={preset['traditional_daily_orders_per_vehicle']} "
                f"as_of={preset['as_of']}"
            )
        except Exception as exc:  # noqa: BLE001 - 缺文件时跳过并提示
            print(f"SKIP {name}: {type(exc).__name__}: {exc}")

    payload = {
        "schema_version": "0.2.0",
        "updated": "2026-11-22",
        "note": "聚合指标，非原始明细；参数用于情景演示，正式引用前请核对口径。",
        "cities": presets,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"written {out} ({len(presets)} presets)")


if __name__ == "__main__":
    main()
