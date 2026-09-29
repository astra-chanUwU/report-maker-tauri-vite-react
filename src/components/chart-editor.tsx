import { useMemo, useRef, useState } from "react";
import type { ReportOptions, SpectraPoint } from "../lib/parseSp3";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const W = 600;
const H = 240;
const EDIT_CAP = 120;

function scaleModel(pts: SpectraPoint[]) {
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

  const editIdx = useMemo(() => {
    if (spectra.length <= EDIT_CAP) return spectra.map((_, i) => i);
    const step = spectra.length / EDIT_CAP;
    return Array.from({ length: EDIT_CAP }, (_, k) => Math.floor(k * step));
  }, [spectra.length]);

  const editPts = useMemo(() => editIdx.map((i) => spectra[i]), [editIdx, spectra]);
  const model = useMemo(
    () => scaleModel(editPts.length > 0 ? editPts : spectra),
    [editPts, spectra]
  );
  const peak = useMemo(() => {
    if (spectra.length === 0) return null;
    let pk = spectra[0];
    for (const p of spectra) if (p.amp > pk.amp) pk = p;
    return pk;
  }, [spectra]);

  if (spectra.length === 0 || !model) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit chart</CardTitle>
          <CardDescription>Drop a file above to enable editing.</CardDescription>
        </CardHeader>
      </Card>
    );
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
    <Card>
      <CardHeader>
        <CardTitle>Edit chart</CardTitle>
        <CardDescription>
          Drag points or edit cells — preview, table and exported .docx update together. In-memory
          only.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none rounded-lg border bg-card"
          style={{ height: 220 }}
          onMouseMove={onSvgMove}
          onMouseUp={() => setDragIdx(null)}
          onMouseLeave={() => setDragIdx(null)}
          role="img"
          aria-label="Editable spectra chart"
        >
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
              onMouseDown={(e) => {
                e.preventDefault();
                setDragIdx(k);
              }}
            />
          ))}
        </svg>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Label htmlFor="smooth">Smoothing</Label>
            <select
              id="smooth"
              className="h-8 rounded-md border border-input bg-background px-2"
              value={smooth}
              onChange={(e) => setSmooth(Number(e.target.value))}
            >
              {[1, 3, 5, 7].map((w) => (
                <option key={w} value={w}>
                  {w === 1 ? "Off" : `±${Math.floor(w / 2)} (w=${w})`}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={smooth <= 1}
              onClick={() => onChange(movingAverage(spectra, smooth))}
            >
              Apply
            </Button>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showPeak}
              onChange={(e) => setShowPeak(e.target.checked)}
            />
            Peak highlight
          </label>
          <div className="flex items-center gap-2">
            <Label htmlFor="point-limit">Points</Label>
            <select
              id="point-limit"
              className="h-8 rounded-md border border-input bg-background px-2"
              value={options.pointLimit ?? 120}
              onChange={(e) => onOptions({ ...options, pointLimit: Number(e.target.value) })}
            >
              {[80, 120, 400].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="max-h-64 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Freq</TableHead>
                <TableHead>Amp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editIdx.slice(0, 60).map((origIdx, k) => (
                <TableRow key={origIdx}>
                  <TableCell>{k + 1}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="h-7"
                      defaultValue={spectra[origIdx].freq}
                      key={`f-${origIdx}-${spectra[origIdx].freq}`}
                      onBlur={(e) => setCell(origIdx, "freq", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
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
          Editing first {Math.min(60, editIdx.length)} of {spectra.length} points (chart handles
          capped at {EDIT_CAP}).
        </p>
      </CardContent>
    </Card>
  );
}
