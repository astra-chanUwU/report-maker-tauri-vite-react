import type { SpectraPoint } from "./parseSp3";

export interface DominantPeak {
  freq: number;
  amp: number;
  index: number;
}

/**
 * Top-N local maxima, at least `minHz` apart (highest amplitude wins).
 * Default N=5 matches the brochure FFT callouts.
 */
export function findDominantPeaks(
  spectra: SpectraPoint[],
  n = 5,
  minHz = 0
): DominantPeak[] {
  if (spectra.length === 0 || n <= 0) return [];
  const local: DominantPeak[] = [];
  for (let i = 1; i < spectra.length - 1; i++) {
    const a = spectra[i].amp;
    if (a >= spectra[i - 1].amp && a >= spectra[i + 1].amp && a > 0) {
      local.push({ freq: spectra[i].freq, amp: a, index: i });
    }
  }
  if (local.length === 0) {
    let best = 0;
    for (let i = 1; i < spectra.length; i++) if (spectra[i].amp > spectra[best].amp) best = i;
    return [{ freq: spectra[best].freq, amp: spectra[best].amp, index: best }];
  }
  local.sort((a, b) => b.amp - a.amp);
  const picked: DominantPeak[] = [];
  const gap = minHz > 0 ? minHz : guessMinHz(spectra);
  for (const p of local) {
    if (picked.some((q) => Math.abs(q.freq - p.freq) < gap)) continue;
    picked.push(p);
    if (picked.length >= n) break;
  }
  picked.sort((a, b) => a.freq - b.freq);
  return picked;
}

function guessMinHz(spectra: SpectraPoint[]): number {
  if (spectra.length < 2) return 1;
  const span = Math.abs(spectra[spectra.length - 1].freq - spectra[0].freq);
  return Math.max(span / 40, 1);
}

export function formatPeakLabel(freq: number): string {
  if (!Number.isFinite(freq)) return "";
  const abs = Math.abs(freq);
  if (abs >= 100) return String(Math.round(freq));
  if (abs >= 10) return freq.toFixed(1);
  return freq.toFixed(2);
}
