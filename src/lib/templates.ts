export interface DocTemplate {
  id: string;
  name: string;
  description: string;
  accentHex: string;
  coverStyle: "classic" | "modern" | "minimal";
}

export const TEMPLATES: DocTemplate[] = [
  {
    id: "classic",
    name: "Classic",
    description: "Centered cover, neutral headings.",
    accentHex: "404040",
    coverStyle: "classic",
  },
  {
    id: "modern",
    name: "Modern",
    description: "Left-aligned cover with blue accent.",
    accentHex: "2563EB",
    coverStyle: "modern",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Compact cover, thin separator.",
    accentHex: "737373",
    coverStyle: "minimal",
  },
];

export function getTemplate(id?: string): DocTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
