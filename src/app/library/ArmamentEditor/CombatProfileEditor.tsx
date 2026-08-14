"use client";

import type { CombatProfileValue } from "./types";
import { GunBatteriesEditor } from "./GunBatteriesEditor";
import { TorpedoTubesEditor } from "./TorpedoTubesEditor";
import { TorpedoTypesEditor } from "./TorpedoTypesEditor";
import { BombLoadoutEditor } from "./BombLoadoutEditor";
import { AntiAircraftEditor } from "./AntiAircraftEditor";

/**
 * Profil de combat complet (canons, torpilles, bombes, DCA) — retour
 * utilisateur 2026-08-14, remplace le textarea JSON `combatProfileText` de
 * LibraryForm.tsx. Un même bloc peut combiner plusieurs armes (ex. un
 * destroyer avec canons + torpilles + DCA) : chaque section reste
 * indépendante, comme le permet déjà le schéma (`combatProfile` est un
 * objet à champs tous optionnels, pas une union à un seul type d'arme).
 */
export function CombatProfileEditor({ value, onChange }: { value: CombatProfileValue; onChange: (next: CombatProfileValue) => void }) {
  return (
    <div className="space-y-4 rounded-md border border-slate-800 p-3">
      <GunBatteriesEditor value={value.guns} onChange={(guns) => onChange({ ...value, guns })} />
      <TorpedoTubesEditor value={value.torpedoTubes} onChange={(torpedoTubes) => onChange({ ...value, torpedoTubes })} />
      {/* Types de torpilles au choix (ex: G7a/G7e) — n'a de sens que si des tubes sont équipés. */}
      {value.torpedoTubes && <TorpedoTypesEditor value={value.torpedoTypes} onChange={(torpedoTypes) => onChange({ ...value, torpedoTypes })} />}
      <BombLoadoutEditor value={value.bombs} onChange={(bombs) => onChange({ ...value, bombs })} />
      <AntiAircraftEditor value={value.antiAircraft} onChange={(antiAircraft) => onChange({ ...value, antiAircraft })} />
    </div>
  );
}
