/** Line schematic of measurement points. Spectra GMachine rows are empty on Elika plants, so this is drawn from Point and Direction. */

import { drawText, encodePng, fillRect, line } from "./png";
import type { SpectraPoint } from "./spectra-catalog";

const W = 720;
const H = 240;
const INK: [number, number, number] = [17, 24, 39];

function axisLetter(directionName: string): string {
  const axis = directionName.trim().replace(/\d+$/, "").trim();
  const ch = axis.charAt(0).toUpperCase();
  return ch === "V" || ch === "H" || ch === "A" || ch === "P" ? ch : "";
}

/** Horizontal shaft with a station per point and V/H/A marks under it. */
export function renderPointSchematic(points: SpectraPoint[]): Uint8Array | null {
  if (points.length === 0) return null;
  const buf = new Uint8Array(W * H * 3);
  buf.fill(255);
  const shaftY = 118;
  line(buf, W, H, 36, shaftY, W - 36, shaftY, INK);
  line(buf, W, H, 36, shaftY + 1, W - 36, shaftY + 1, INK);

  const n = points.length;
  points.forEach((point, i) => {
    const cx = Math.round(80 + (i * (W - 160)) / Math.max(1, n - 1));
    fillRect(buf, W, H, cx - 22, shaftY - 36, 44, 52, [255, 255, 255]);
    line(buf, W, H, cx - 22, shaftY - 36, cx + 22, shaftY - 36, INK);
    line(buf, W, H, cx - 22, shaftY + 16, cx + 22, shaftY + 16, INK);
    line(buf, W, H, cx - 22, shaftY - 36, cx - 22, shaftY + 16, INK);
    line(buf, W, H, cx + 22, shaftY - 36, cx + 22, shaftY + 16, INK);
    const title = String(i + 1);
    drawText(buf, W, H, cx - 4, shaftY - 28, title, INK, 2);
    const axes = point.directions.map((d) => axisLetter(d.name)).filter(Boolean);
    const label = axes.join(" ");
    if (label) drawText(buf, W, H, Math.round(cx - (label.length * 6) / 2), shaftY + 28, label, INK, 1);
    const name = (point.name || "").trim().toUpperCase().replace(/[^0-9AHPV .-]/g, "");
    if (name) drawText(buf, W, H, Math.round(cx - Math.min(40, name.length * 3)), shaftY - 52, name.slice(0, 8), INK, 1);
  });
  return encodePng(buf, W, H);
}
