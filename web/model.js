/* 前端计算内核：与 Python 核心模型保持同一套公式。
 * 可在 Node 中直接 require 做一致性测试。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RobotaxiModel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_PRESSURES = [0.05, 0.1, 0.2];

  function analyze(preset, pressures, netRatio) {
    pressures = pressures || DEFAULT_PRESSURES;
    netRatio = netRatio == null ? 1.0 : Number(netRatio);

    const base = Number(preset.base_daily_orders);
    const fleet = Number(preset.traditional_fleet);
    const tradPer = Number(preset.traditional_daily_orders_per_vehicle);
    const robotPer = Number(preset.robotaxi_daily_orders_per_vehicle);

    if (!(base > 0) || !(fleet > 0) || !(tradPer > 0) || !(robotPer > 0)) {
      throw new Error("金额/车辆输入必须为正数");
    }
    if (!(netRatio > 0 && netRatio <= 1)) {
      throw new Error("净替代系数需在 (0, 1] 区间");
    }

    return pressures.map(function (raw) {
      const p = Number(raw);
      if (!(p >= 0 && p <= 1)) throw new Error("情景压力需在 [0, 1] 区间");

      const eff = p * netRatio;
      const substituted = base * eff;
      // 1e-9 抵消浮点误差，避免 2355 被算成 2356
      const needed = Math.ceil(substituted / robotPer - 1e-9);
      const tradAfterOrders = Math.max(base - substituted, 0);
      const tradAfterFleet = tradAfterOrders / tradPer;
      const reduction = (fleet - tradAfterFleet) / fleet;

      return {
        pressure: p,
        effective_pressure: eff,
        substituted_orders: substituted,
        robotaxi_needed: needed,
        traditional_orders_after: tradAfterOrders,
        traditional_fleet_after: Math.round(tradAfterFleet),
        traditional_reduction_pct: reduction * 100,
      };
    });
  }

  return { DEFAULT_PRESSURES: DEFAULT_PRESSURES, analyze: analyze };
});
