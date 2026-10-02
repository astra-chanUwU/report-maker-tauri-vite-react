export type CoverStyle = "classic" | "modern" | "minimal" | "industrial";

export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  /** Heading / accent RGB hex without #. */
  accentHex: string;
  /** Soft tint for bars and table fills. */
  accentSoft: string;
  /** Body heading color (often same as accent or darker). */
  headingHex: string;
  coverStyle: CoverStyle;
  /** Cover title size in half-points. */
  titleSize: number;
  /** Body text font for Latin reports. */
  font: string;
}

export const TEMPLATES: DocTemplate[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Centered cover, serif titles, formal meta block.",
    accentHex: "1B4F72",
    accentSoft: "D6EAF8",
    headingHex: "1B4F72",
    coverStyle: "classic",
    titleSize: 56,
    font: "Georgia",
  },
  {
    id: "modern",
    name: "Modern",
    description: "Bold accent banner, left-aligned, clean sans feel.",
    accentHex: "0F766E",
    accentSoft: "CCFBF1",
    headingHex: "134E4A",
    coverStyle: "modern",
    titleSize: 52,
    font: "Calibri",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Airy cover, thin rules, muted typography.",
    accentHex: "525252",
    accentSoft: "F5F5F5",
    headingHex: "262626",
    coverStyle: "minimal",
    titleSize: 48,
    font: "Calibri",
  },
  {
    id: "industrial",
    name: "Industrial",
    description: "Plant-report look: deep green bars, dense meta grid.",
    accentHex: "1B5E20",
    accentSoft: "E8F5E9",
    headingHex: "1B5E20",
    coverStyle: "industrial",
    titleSize: 50,
    font: "Times New Roman",
  },
];

export function getTemplate(id?: string): DocTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
