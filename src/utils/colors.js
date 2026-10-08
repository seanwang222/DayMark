/**
 * 完成率 → 颜色（统一蓝色色阶）
 *
 * 设计目标：让「完成频率 / 完成率」在 低 → 高 之间用一条
 * 连续蓝色色带表达，由深蓝过渡到亮蓝，全程仅使用蓝色（无青、无绿）。
 *
 * 色相固定为蓝(213°)，仅饱和度与亮度随完成率抬升，使相邻完成率的颜色
 * 几乎连续、肉眼可辨渐变，避免任何色相跳变。
 *
 * rate = 0（或缺失）返回空白深灰，与「低完成率」区分，也和深色背景融洽。
 */

export const RATE_COLOR_NONE = '#161b22';

export function getRateColor(rate) {
  if (rate == null || rate <= 0) return RATE_COLOR_NONE;
  const t = Math.max(0, Math.min(rate, 100)) / 100;
  const h = 213; // 固定蓝色相
  const s = 60 + 35 * t; // 60% → 95%
  const l = 22 + 36 * t; // 22% → 58%
  return `hsl(${h}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

/** 图例用的水平渐变条（与 getRateColor 同色带，连续采样） */
export function getRateGradient() {
  const stops = [0, 20, 40, 60, 80, 100].map((r) => getRateColor(r));
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
