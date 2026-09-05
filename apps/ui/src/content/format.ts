export interface EvaluationValue {
  readonly cp: number | null | undefined;
  readonly mate: number | null;
}

export interface CloudEvaluationValue extends EvaluationValue {
  readonly depth: number;
}

export function centipawnText(cp: number): string {
  return (cp >= 0 ? "+" : "") + (cp / 100).toFixed(2);
}

export function evaluationText(value: EvaluationValue): string {
  if (value.mate !== null) return `M${Math.abs(value.mate)}`;
  return centipawnText(value.cp ?? 0);
}

export function cloudEvaluationText(value: CloudEvaluationValue | null): string {
  return value ? `${evaluationText(value)}  ·  depth ${value.depth}` : "—";
}

export function numbered(sans: readonly string[], startPly = 0): string {
  const out: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    const ply = startPly + i;
    const no = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) out.push(`${no}. ${sans[i]}`);
    else if (i === 0) out.push(`${no}... ${sans[i]}`);
    else out.push(sans[i] ?? "");
  }
  return out.join(" ");
}

export function centipawnDelta(delta: number | null): string {
  return delta == null ? "" : ` Δ${delta <= 0 ? "+" : "−"}${(Math.abs(delta) / 100).toFixed(2)}`;
}

export function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return JSON.stringify(value);
}

export function diffValue(value: unknown): string {
  if (value === null) return "not set";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "number")
    return Number.isInteger(value) ? displayValue(value) : value.toFixed(2);
  return displayValue(value);
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
