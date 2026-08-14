"use client";

import type { GunArc } from "./types";

const ARC_LABELS: Record<GunArc, string> = {
  FORWARD: "Avant",
  AFT: "Arrière",
  ALL_ROUND: "Tous azimuts",
  BROADSIDE: "Travers",
};

/** Menu déroulant d'arc de tir, partagé par les batteries de canons et les tubes lance-torpilles. */
export function GunArcSelect({ value, onChange, className }: { value: GunArc; onChange: (arc: GunArc) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as GunArc)} className={className}>
      {(Object.keys(ARC_LABELS) as GunArc[]).map((arc) => (
        <option key={arc} value={arc}>
          {ARC_LABELS[arc]}
        </option>
      ))}
    </select>
  );
}
