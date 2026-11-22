(function () {
  "use strict";

  const M = window.RobotaxiModel;
  const PRESSURES = M.DEFAULT_PRESSURES;
  const BASIS_LABELS = {
    active: "日均活跃运力",
    implied_active: "隐含活跃运力（订单÷单车订单）",
  };

  const $ = (id) => document.getElementById(id);
  const state = { presets: [], current: null, last: null };

  /* ---------- helpers ---------- */
  function fmtInt(n) {
    return Math.round(Number(n)).toLocaleString("zh-CN");
  }
  function fmtPct(n) {
    return Number(n).toFixed(1) + "%";
  }
  function compact(n) {
    n = Number(n);
    return n >= 10000 ? (n / 1000).toFixed(1) + "k" : fmtInt(n);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function setError(msg) {
    const content = document.querySelector(".content");
    let box = content.querySelector(".error-box");
    if (!msg) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.className = "error-box";
      content.insertBefore(box, content.firstChild);
    }
    box.textContent = msg;
  }

  /* ---------- init ---------- */
  async function init() {
    try {
      const res = await fetch("data/cities.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      state.presets = Array.isArray(data.cities) ? data.cities : [];
      if (!state.presets.length) throw new Error("cities.json 中没有城市");

      const select = $("citySelect");
      select.innerHTML = state.presets
        .map((p) => '<option value="' + esc(p.key) + '">' + esc(p.name) + "</option>")
        .join("");

      const preferred =
        state.presets.find((p) => p.key === "guangzhou") || state.presets[0];
      select.value = preferred.key;
      applyPreset(preferred);
      bindEvents();
    } catch (err) {
      setError(
        "无法加载 data/cities.json（" +
          err.message +
          "）。本地预览请在仓库根目录运行 `python -m http.server`，再访问 http://localhost:8000/。"
      );
      $("cityMeta").textContent = "加载失败";
    }
  }

  function bindEvents() {
    $("citySelect").addEventListener("change", function (e) {
      const preset = state.presets.find((p) => p.key === e.target.value);
      if (preset) applyPreset(preset);
    });
    ["baseOrders", "fleet", "tradPer", "robotPer", "netRatio"].forEach(function (id) {
      $(id).addEventListener("input", recompute);
    });
    $("resetBtn").addEventListener("click", function () {
      if (state.current) applyPreset(state.current);
    });
    $("memoBtn").addEventListener("click", renderMemo);
    $("jsonBtn").addEventListener("click", downloadJson);
    $("copyBtn").addEventListener("click", copyMemo);
  }

  function applyPreset(preset) {
    state.current = preset;
    $("baseOrders").value = preset.base_daily_orders;
    $("fleet").value = preset.traditional_fleet;
    $("tradPer").value = preset.traditional_daily_orders_per_vehicle;
    $("robotPer").value = preset.robotaxi_daily_orders_per_vehicle;
    $("netRatio").value = 1;
    $("netRatioValue").textContent = "1.00";
    renderMeta(preset);
    recompute();
  }

  /* ---------- compute ---------- */
  function currentInputs() {
    return {
      base_daily_orders: Number($("baseOrders").value),
      traditional_fleet: Number($("fleet").value),
      traditional_daily_orders_per_vehicle: Number($("tradPer").value),
      robotaxi_daily_orders_per_vehicle: Number($("robotPer").value),
    };
  }

  function recompute() {
    const preset = state.current;
    if (!preset) return;
    const netRatio = Number($("netRatio").value);
    $("netRatioValue").textContent = netRatio.toFixed(2);

    try {
      const inputs = Object.assign({}, preset, currentInputs());
      const results = M.analyze(inputs, PRESSURES, netRatio);
      state.last = { preset: preset, inputs: inputs, netRatio: netRatio, results: results };
      setError(null);
      renderKPIs(results);
      renderBar(results);
      renderHeatmap(inputs, netRatio);
      renderTable(results);
      renderAssumptions(inputs, netRatio);
      $("memoPanel").hidden = true;
    } catch (err) {
      setError("输入有误：" + err.message);
    }
  }

  /* ---------- renderers ---------- */
  function renderMeta(preset) {
    const tags = [];
    if (preset.as_of) tags.push("数据截至 " + esc(preset.as_of));
    if (preset.fleet_basis)
      tags.push("车队口径：" + esc(BASIS_LABELS[preset.fleet_basis] || preset.fleet_basis));
    if (preset.derived_orders) tags.push("订单为派生口径");
    if (preset.source_url)
      tags.push('<a href="' + esc(preset.source_url) + '" target="_blank" rel="noopener">来源 ↗</a>');

    let html = tags.map((t) => '<span class="tag">' + t + "</span>").join("");
    if (preset.note) html += '<div style="margin-top:6px">' + esc(preset.note) + "</div>";
    $("cityMeta").innerHTML = html;
  }

  function renderKPIs(results) {
    $("kpis").innerHTML = results
      .map(function (r, i) {
        const cls = ["kpi", "kpi p2", "kpi p3"][i] || "kpi";
        return (
          '<div class="' + cls + '">' +
          '<div class="kpi-pressure">情景压力 ' + fmtPct(r.pressure * 100) + "</div>" +
          '<div class="kpi-value">' + fmtInt(r.robotaxi_needed) + "<small>辆</small></div>" +
          '<div class="kpi-sub">传统车队剩余 <b>' + fmtInt(r.traditional_fleet_after) + "</b> 辆</div>" +
          '<div class="kpi-sub">传统车队降幅 <b>' + fmtPct(r.traditional_reduction_pct) + "</b></div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderBar(results) {
    const w = 640, h = 260;
    const pad = { l: 58, r: 16, t: 24, b: 40 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const max = Math.max.apply(null, results.map((r) => r.robotaxi_needed).concat([1]));
    const yMax = max * 1.15;
    const ticks = 4;
    const parts = [];

    for (let i = 0; i <= ticks; i++) {
      const v = (yMax * i) / ticks;
      const y = pad.t + plotH - (plotH * i) / ticks;
      parts.push(
        '<line class="grid-line" x1="' + pad.l + '" y1="' + y + '" x2="' + (w - pad.r) + '" y2="' + y + '"/>'
      );
      parts.push(
        '<text class="axis-label" x="' + (pad.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' +
          fmtInt(v) + "</text>"
      );
    }

    const band = plotW / results.length;
    results.forEach(function (r, i) {
      const bw = band * 0.5;
      const x = pad.l + band * i + (band - bw) / 2;
      const bh = plotH * (r.robotaxi_needed / yMax);
      const y = pad.t + plotH - bh;
      parts.push(
        '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh +
          '" rx="6" fill="url(#barGrad)"/>'
      );
      parts.push(
        '<text class="bar-val" x="' + (x + bw / 2) + '" y="' + (y - 8) + '" text-anchor="middle">' +
          fmtInt(r.robotaxi_needed) + "</text>"
      );
      parts.push(
        '<text class="axis-label" x="' + (x + bw / 2) + '" y="' + (pad.t + plotH + 24) +
          '" text-anchor="middle">' + fmtPct(r.pressure * 100) + "</text>"
      );
    });

    $("barChart").innerHTML =
      '<svg viewBox="0 0 ' + w + " " + h + '" xmlns="http://www.w3.org/2000/svg">' +
      "<defs><linearGradient id=\"barGrad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">" +
      '<stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#1d4ed8"/>' +
      "</linearGradient></defs>" +
      parts.join("") +
      "</svg>";
  }

  function colorFor(t) {
    const stops = [
      [238, 244, 251],
      [147, 197, 253],
      [37, 99, 235],
      [30, 58, 138],
    ];
    t = Math.max(0, Math.min(1, t));
    const seg = (stops.length - 1) * t;
    const i = Math.min(Math.floor(seg), stops.length - 2);
    const f = seg - i;
    const a = stops[i], b = stops[i + 1];
    const c = a.map(function (v, k) {
      return Math.round(v + (b[k] - v) * f);
    });
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  }

  function renderHeatmap(inputs, netRatio) {
    const pressures = [];
    for (let p = 0.05; p <= 0.3001; p += 0.05) pressures.push(Math.round(p * 100) / 100);
    const ratios = [];
    for (let r = 1.0; r >= 0.1999; r -= 0.1) ratios.push(Math.round(r * 10) / 10);

    let max = 1;
    const grid = ratios.map(function (ratio) {
      return pressures.map(function (p) {
        const v = M.analyze(inputs, [p], ratio)[0].robotaxi_needed;
        if (v > max) max = v;
        return v;
      });
    });

    let html = "<table><thead><tr><th>净替代 \\ 压力</th>";
    pressures.forEach(function (p) {
      html += "<th>" + fmtPct(p * 100) + "</th>";
    });
    html += "</tr></thead><tbody>";

    grid.forEach(function (row, ri) {
      html += '<tr><td class="row-label">' + ratios[ri].toFixed(1) + "</td>";
      row.forEach(function (v) {
        const t = v / max;
        const color = colorFor(t);
        const fg = t > 0.55 ? "#ffffff" : "#0f172a";
        html +=
          '<td style="background:' + color + ";color:" + fg +
          '" title="需新增 ' + fmtInt(v) + ' 辆">' + compact(v) + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    html +=
      '<div class="heatmap-legend"><span>少</span><span class="legend-bar"></span><span>多</span>' +
      '<span class="muted">（当前净替代系数 ' + netRatio.toFixed(2) + "）</span></div>";
    $("heatmap").innerHTML = html;
  }

  function renderTable(results) {
    let html =
      "<thead><tr><th>情景压力</th><th>被替代订单/日</th><th>需新增 Robotaxi</th>" +
      "<th>传统车队剩余</th><th>传统车队降幅</th></tr></thead><tbody>";
    results.forEach(function (r) {
      html +=
        "<tr><td>" + fmtPct(r.pressure * 100) + "</td>" +
        "<td>" + fmtInt(r.substituted_orders) + "</td>" +
        "<td>" + fmtInt(r.robotaxi_needed) + " 辆</td>" +
        "<td>" + fmtInt(r.traditional_fleet_after) + " 辆</td>" +
        "<td>" + fmtPct(r.traditional_reduction_pct) + "</td></tr>";
    });
    html += "</tbody>";
    $("scenarioTable").innerHTML = html;
  }

  function renderAssumptions(inputs, netRatio) {
    const rows = [
      ["城市", inputs.name],
      ["数据截至", inputs.as_of || "—"],
      ["聚合窗口", inputs.window || "—"],
      ["日均订单", fmtInt(inputs.base_daily_orders) + " 单"],
      ["传统车队", fmtInt(inputs.traditional_fleet) + " 辆"],
      ["传统单车日均订单", Number(inputs.traditional_daily_orders_per_vehicle).toFixed(2) + " 单"],
      ["Robotaxi 单车日均订单", Number(inputs.robotaxi_daily_orders_per_vehicle).toFixed(2) + " 单"],
      ["净替代系数", netRatio.toFixed(2)],
      ["车队口径", BASIS_LABELS[inputs.fleet_basis] || inputs.fleet_basis || "—"],
      ["订单口径", inputs.derived_orders ? "派生（单车订单 × 活跃车辆）" : "直接口径"],
    ];
    if (inputs.note) rows.push(["说明", inputs.note]);
    if (inputs.source_url)
      rows.push([
        "来源",
        '<a class="source" href="' + esc(inputs.source_url) + '" target="_blank" rel="noopener">' +
          esc(inputs.source_url) + "</a>",
      ]);

    $("assumptions").innerHTML = rows
      .map(function (r) {
        return "<dt>" + esc(r[0]) + "</dt><dd>" + (r[0] === "来源" ? r[1] : esc(r[1])) + "</dd>";
      })
      .join("");
  }

  /* ---------- memo / export ---------- */
  function buildMemo() {
    if (!state.last) return "";
    const s = state.last;
    const lines = [];
    lines.push("【" + s.preset.name + " · Robotaxi 车队规模情景测算】");
    lines.push(
      "以日均订单 " + fmtInt(s.inputs.base_daily_orders) + " 单、传统车队 " +
      fmtInt(s.inputs.traditional_fleet) + " 辆、单车日均订单 " +
      Number(s.inputs.traditional_daily_orders_per_vehicle).toFixed(2) + " 单为基准："
    );
    s.results.forEach(function (r) {
      lines.push(
        "· 订单压力 " + fmtPct(r.pressure * 100) + "：需新增 Robotaxi " +
        fmtInt(r.robotaxi_needed) + " 辆；传统车队剩余 " +
        fmtInt(r.traditional_fleet_after) + " 辆，降幅 " +
        fmtPct(r.traditional_reduction_pct) + "。"
      );
    });
    lines.push(
      "说明：净替代系数 " + s.netRatio.toFixed(2) +
      "；结果为情景测算，未考虑诱导需求、政策许可与运营成本变化，不构成投资建议。"
    );
    if (s.preset.as_of) lines.push("数据截至：" + s.preset.as_of + "。");
    if (s.preset.note) lines.push("口径：" + s.preset.note);
    return lines.join("\n");
  }

  function renderMemo() {
    if (!state.last) return;
    $("memoText").textContent = buildMemo();
    $("memoPanel").hidden = false;
    $("memoPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function copyMemo() {
    const text = $("memoText").textContent;
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $("copyBtn").textContent = "已复制";
        setTimeout(function () { $("copyBtn").textContent = "复制"; }, 1500);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function downloadJson() {
    if (!state.last) return;
    const payload = {
      generated_at: new Date().toISOString(),
      city: state.last.preset.name,
      city_key: state.last.preset.key,
      inputs: state.last.inputs,
      net_substitution_ratio: state.last.netRatio,
      scenarios: state.last.results,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "robotaxi-" + state.last.preset.key + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  init();
})();
