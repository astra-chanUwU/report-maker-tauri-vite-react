import { useMemo, useRef, useState } from "react";
import type { ReportOptions, SpectraPoint } from "../lib/parseSp3";
import { LineChart } from "lucide-react";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Select } from "./ui/form";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { useElementWidth } from "./ui/use-width";

const H = 340;
const EDIT_CAP = 120;

function scaleModel(pts: SpectraPoint[], W: number) {
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
  if (!Number.isFinite(fMin)) return null;
  if (fMax === fMin) fMax = fMin + 1;
  if (aMax === aMin) aMax = aMin + 1;
  const pad = (aMax - aMin) * 0.05 || 1;
  aMin -= pad;
  aMax += pad;
  const X = (f: number) => 40 + ((f - fMin) / (fMax - fMin)) * (W - 50);
  const Y = (a: number) => H - 30 - ((a - aMin) / (aMax - aMin)) * (H - 50);
  const invAmp = (y: number) => aMin + ((H - 30 - y) / (H - 50)) * (aMax - aMin);
  return { X, Y, invAmp, fMin, fMax, aMin, aMax };
}

export function movingAverage(spectra: SpectraPoint[], window: number): SpectraPoint[] {
  if (window <= 1) return spectra;
  const half = Math.floor(window / 2);
  return spectra.map((p, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < spectra.length) {
        sum += spectra[k].amp;
        n++;
      }
    }
    return { freq: p.freq, amp: Math.round((sum / n) * 1000) / 1000 };
  });
}

export function ChartEditor({
  spectra,
  onChange,
  options,
  onOptions,
}: {
  spectra: SpectraPoint[];
  onChange: (next: SpectraPoint[]) => void;
  options: ReportOptions;
  onOptions: (next: ReportOptions) => void;
}) {
  const [showPeak, setShowPeak] = useState(true);
  const [smooth, setSmooth] = useState(1);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [wrapRef, W] = useElementWidth<HTMLDivElement>(600);

  const editIdx = useMemo(() => {
    if (spectra.length <= EDIT_CAP) return spectra.map((_, i) => i);
    const step = spectra.length / EDIT_CAP;
    return Array.from({ length: EDIT_CAP }, (_, k) => Math.floor(k * step));
  }, [spectra.length]);

  const editPts = useMemo(() => editIdx.map((i) => spectra[i]), [editIdx, spectra]);
  const model = useMemo(
    () => scaleModel(editPts.length > 0 ? editPts : spectra, W),
    [editPts, spectra, W]
  );
  const peak = useMemo(() => {
    if (spectra.length === 0) return null;
    let pk = spectra[0];
    for (const p of spectra) if (p.amp > pk.amp) pk = p;
    return pk;
  }, [spectra]);

  if (spectra.length === 0 || !model) {
    return <Panel title="Spectrum editor" description="Load measurement data to enable editing." />;
  }

  const path = editPts
    .map((p) => `${model.X(p.freq).toFixed(1)},${model.Y(p.amp).toFixed(1)}`)
    .join(" ");

  const onSvgMove = (e: React.MouseEvent) => {
    if (dragIdx === null || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const amp = Math.round(model.invAmp(Math.max(10, Math.min(H - 30, y))) * 1000) / 1000;
    const origIdx = editIdx[dragIdx];
    const next = spectra.slice();
    next[origIdx] = { ...next[origIdx], amp };
    onChange(next);
  };

  const setCell = (origIdx: number, field: "freq" | "amp", value: string) => {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const next = spectra.slice();
    next[origIdx] = { ...next[origIdx], [field]: v };
    onChange(next);
  };

  return (
    <Panel
      icon={<LineChart />}
      title="Spectrum editor"
      description="Drag points vertically or edit values in the table. Preview and report update together."
      actions={
        <>
          <Label htmlFor="smooth" className="text-muted-foreground">
            Smoothing
          </Label>
          <Select
            id="smooth"
            className="w-auto"
            value={smooth}
            onChange={(e) => setSmooth(Number(e.target.value))}
          >
            {[1, 3, 5, 7].map((w) => (
              <option key={w} value={w}>
                {w === 1 ? "Off" : `±${Math.floor(w / 2)} (w=${w})`}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={smooth <= 1}
            onClick={() => onChange(movingAverage(spectra, smooth))}
          >
            Apply
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Label htmlFor="point-limit" className="text-muted-foreground">
            Table rows in report
          </Label>
          <Select
            id="point-limit"
            className="w-auto"
            value={options.pointLimit ?? 120}
            onChange={(e) => onOptions({ ...options, pointLimit: Number(e.target.value) })}
          >
            {[80, 120, 400].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={showPeak}
              onChange={(e) => setShowPeak(e.target.checked)}
            />
            Peak
          </label>
        </>
      }
      contentClassName="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]"
    >
      <div ref={wrapRef} className="grid min-w-0 content-start gap-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full touch-none rounded-md border bg-card"
          style={{ height: H }}
          onMouseMove={onSvgMove}
          onMouseUp={() => setDragIdx(null)}
          onMouseLeave={() => setDragIdx(null)}
          role="img"
          aria-label={`Editable spectra chart — ${spectra.length} points, peak ${peak?.amp} at ${peak?.freq}`}
        >
          <title>Editable spectra chart</title>
          <desc>
            {spectra.length} points, peak {peak?.amp} at {peak?.freq}. Drag points vertically or use
            arrow keys on selected points.
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
          <polyline points={path} fill="none" stroke="#2563eb" strokeWidth={2} />
          {showPeak && peak ? (
            <circle cx={model.X(peak.freq)} cy={model.Y(peak.amp)} r={5} fill="#dc2626" />
          ) : null}
          {editPts.map((p, k) => (
            <circle
              key={k}
              cx={model.X(p.freq)}
              cy={model.Y(p.amp)}
              r={dragIdx === k ? 7 : 4}
              fill={dragIdx === k ? "#1d4ed8" : "#93c5fd"}
              stroke="#1e3a8a"
              strokeWidth={1}
              style={{ cursor: "ns-resize" }}
              tabIndex={0}
              role="slider"
              aria-label={`Point ${k + 1} freq ${p.freq} amp ${p.amp}`}
              aria-valuemin={Math.floor(model.aMin)}
              aria-valuemax={Math.ceil(model.aMax)}
              aria-valuenow={p.amp}
              onMouseDown={(e) => {
                e.preventDefault();
                setDragIdx(k);
              }}
              onKeyDown={(e) => {
                const step = (model.aMax - model.aMin) / 100 || 0.01;
                let delta = 0;
                if (e.key === "ArrowUp") delta = step;
                else if (e.key === "ArrowDown") delta = -step;
                else if (e.key === "PageUp") delta = step * 10;
                else if (e.key === "PageDown") delta = -step * 10;
                else return;
                e.preventDefault();
                const origIdx = editIdx[k];
                const next = spectra.slice();
                next[origIdx] = {
                  ...next[origIdx],
                  amp: Math.round((p.amp + delta) * 1000) / 1000,
                };
                onChange(next);
              }}
              onFocus={() => setDragIdx(k)}
              onBlur={() => setDragIdx(null)}
            />
          ))}
        </svg>
        <p className="text-xs text-muted-foreground">
          {spectra.length.toLocaleString()} points · {editIdx.length} drag handles
          {peak ? ` · peak ${peak.amp} @ ${peak.freq}` : ""}. Arrow keys nudge the focused handle.
        </p>
      </div>

      <div className="grid content-start gap-2">
        <div className="overflow-hidden rounded-md border">
          <Table containerClassName="max-h-[340px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Freq</TableHead>
                <TableHead>Amp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editIdx.slice(0, 60).map((origIdx, k) => (
                <TableRow key={origIdx}>
                  <TableCell className="text-muted-foreground">{k + 1}</TableCell>
                  <TableCell className="py-1">
                    <Input
                      type="number"
                      className="h-7"
                      defaultValue={spectra[origIdx].freq}
                      key={`f-${origIdx}-${spectra[origIdx].freq}`}
                      onBlur={(e) => setCell(origIdx, "freq", e.target.value)}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <Input
                      type="number"
                      step="0.001"
                      className="h-7"
                      defaultValue={spectra[origIdx].amp}
                      key={`a-${origIdx}-${spectra[origIdx].amp}`}
                      onBlur={(e) => setCell(origIdx, "amp", e.target.value)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Table edits the first {Math.min(60, editIdx.length)} handles.
        </p>
      </div>
    </Panel>
  );
}
