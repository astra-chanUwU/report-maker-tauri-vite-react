import { useMemo } from "react";
import { useUi } from "../lib/i18n";
import type { SpectraPoint } from "../lib/parseSp3";
import { previewPeakMarks } from "./spectra-chart-peaks";

const W = 600;
const H = 240;

export function SpectraChart({
  spectra,
  height = 220,
  highlightPeak = true,
}: {
  spectra: SpectraPoint[];
  height?: number;
  highlightPeak?: boolean;
}) {
  const { t } = useUi();
  const model = useMemo(() => {
    if (spectra.length === 0) return null;
    const pts = spectra.length > 500 ? downsample(spectra, 500) : spectra;
    let fMin = Infinity;
    let fMax = -Infinity;
    let aMin = Infinity;
    let aMax = -Infinity;
    for (const p of pts) {
      if (p.freq < fMin) fMin = p.freq;
      if (p.freq > fMax) fMax = p.freq;
      if (p.amp < aMin) aMin = p.amp;
      if (p.amp > aMax) aMax = p.amp;
    }
    if (fMax === fMin) fMax = fMin + 1;
    if (aMax === aMin) aMax = aMin + 1;
    const X = (f: number) => 40 + ((f - fMin) / (fMax - fMin)) * (W - 50);
    const Y = (a: number) => H - 30 - ((a - aMin) / (aMax - aMin)) * (H - 50);
    const peaks = previewPeakMarks(pts).map((peak) => {
      const x = X(peak.freq);
      const y = Y(peak.amp);
      let labelY = y - peak.lift;
      if (labelY < 14) labelY = Math.min(H - 16, y + 14);
      return { ...peak, x, y, labelY };
    });
    return {
      path: pts.map((p) => `${X(p.freq).toFixed(1)},${Y(p.amp).toFixed(1)}`).join(" "),
      peaks,
    };
  }, [spectra]);

  if (!model) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
        {t("spectraEmpty")}
      </div>
    );
  }

  const peakSummary = model.peaks.map((p) => p.label).join(", ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-lg border bg-card"
      style={{ height }}
      role="img"
      aria-label={`Spectra preview chart — ${spectra.length} points, peaks ${peakSummary}`}
    >
      <title>Spectra preview</title>
      <desc>
        {spectra.length} points, peaks {peakSummary}
      </desc>
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={40}
          x2={W - 10}
          y1={H * t}
          y2={H * t}
          stroke="currentColor"
          strokeOpacity={0.12}
        />
      ))}
      <line x1={40} x2={40} y1={10} y2={H - 30} stroke="currentColor" strokeOpacity={0.3} />
      <line x1={40} x2={W - 10} y1={H - 30} y2={H - 30} stroke="currentColor" strokeOpacity={0.3} />
      <polyline
        points={model.path}
        fill="none"
        stroke="#2563eb"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {highlightPeak
        ? model.peaks.map((peak) => (
            <g key={`${peak.index}-${peak.freq}`}>
              <circle cx={peak.x} cy={peak.y} r={4} fill="#dc2626" />
              <text
                x={peak.x}
                y={peak.labelY}
                textAnchor="middle"
                fill="#dc2626"
                fontSize={11}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {peak.label}
              </text>
            </g>
          ))
        : null}
    </svg>
  );
}

function downsample(spectra: SpectraPoint[], max: number): SpectraPoint[] {
  if (spectra.length <= max) return spectra;
  const step = spectra.length / max;
  const out: SpectraPoint[] = [];
  for (let i = 0; i < max; i++) out.push(spectra[Math.floor(i * step)]);
  return out;
}
