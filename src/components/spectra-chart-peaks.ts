import type { SpectraPoint } from "../lib/parseSp3";
import { findDominantPeaks, formatPeakLabel } from "../lib/spectra-peaks";

export interface PreviewPeakMark {
  freq: number;
  amp: number;
  index: number;
  label: string;
  /** Pixels above the dot. Stagger matches the Word gallery callouts. */
  lift: number;
}

/** Dominant peaks drawn on the on-screen spectrum, same selection as the Word FFT gallery. */
export function previewPeakMarks(spectra: SpectraPoint[], n = 5): PreviewPeakMark[] {
  return findDominantPeaks(spectra, n).map((peak, i) => ({
    freq: peak.freq,
    amp: peak.amp,
    index: peak.index,
    label: formatPeakLabel(peak.freq),
    lift: 22 + (i % 3) * 16,
  }));
}
