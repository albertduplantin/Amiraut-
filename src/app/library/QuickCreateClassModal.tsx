"use client";

import { useState, useTransition } from "react";
import { createLibraryClassAction } from "./actions";
import { LibraryClassFields, type LibraryClassFieldsValues } from "./LibraryClassFields";
import type { LibraryClassOption } from "../scenarios/new/builder/types";
import { SHIP_TYPES } from "../scenarios/new/builder/unitTypeTaxonomy";
import { SensorsEditor } from "./ArmamentEditor/SensorsEditor";
import { CombatProfileEditor } from "./ArmamentEditor/CombatProfileEditor";
import { WeaponSystemsEditor } from "./ArmamentEditor/WeaponSystemsEditor";
import {
  type Sensor,
  type CombatProfileValue,
  type WeaponSystemRow,
  EMPTY_COMBAT_PROFILE,
  combatProfileToJson,
  weaponSystemsToJson,
} from "./ArmamentEditor/types";

function emptyFieldValues(): LibraryClassFieldsValues {
  return {
    key: "",
    name: "",
    nation: "",
    category: "SURFACE_SHIP",
    theater: "Atlantique/Arctique 1939-45",
    maxSpeedKnots: "",
    lengthMeters: "",
    beamMeters: "",
    turningRadiusM: "",
    accelerationKnotsPerMin: "",
    agility: "",
    pilotSkill: "",
    detectability: "1",
    iconKey: SHIP_TYPES[0].key,
    profileImageUrl: "",
    resistancePoints: "",
    historicalNote: "",
    passive: false,
    enduranceMinutes: "",
    depthChargeStock: "",
    hedgehogStock: "",
    submergedRangeNmAt4kt: "",
    oxygenEnduranceHours: "",
    torpedoStock: "",
    emergencyDiveSeconds: "",
  };
}

/**
 * Création rapide d'une classe de bibliothèque "à la volée" (Phase 6,
 * retour utilisateur 2026-08-14 — "il faut pouvoir créer des avions à la
 * volée", sans rupture de flux) : réutilise exactement les mêmes
 * composants que la page complète (`/library/new`, voir `LibraryForm.tsx`)
 * dans un panneau flottant plutôt qu'une page dédiée — mêmes validations,
 * même action serveur (`createLibraryClassAction`, inchangée). Ferme et
 * prévient le parent (`onCreated`) avec la classe créée, pour l'ajouter
 * immédiatement au panneau bibliothèque sans recharger la page.
 */
export function QuickCreateClassModal({ onClose, onCreated }: { onClose: () => void; onCreated: (newClass: LibraryClassOption) => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<LibraryClassFieldsValues>(emptyFieldValues);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [combatProfile, setCombatProfile] = useState<CombatProfileValue>(EMPTY_COMBAT_PROFILE);
  const [weaponSystems, setWeaponSystems] = useState<WeaponSystemRow[]>([]);

  function updateValues(patch: Partial<LibraryClassFieldsValues>) {
    setValues((v) => ({ ...v, ...patch }));
  }

  function numOrUndefined(text: string): number | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }

  function submit() {
    setError(null);
    const payload = {
      key: values.key.trim(),
      name: values.name.trim(),
      nation: values.nation.trim(),
      category: values.category,
      theater: values.theater.trim() || undefined,
      maxSpeedKnots: numOrUndefined(values.maxSpeedKnots),
      lengthMeters: numOrUndefined(values.lengthMeters),
      beamMeters: numOrUndefined(values.beamMeters),
      turningRadiusM: numOrUndefined(values.turningRadiusM),
      accelerationKnotsPerMin: numOrUndefined(values.accelerationKnotsPerMin),
      agility: numOrUndefined(values.agility),
      pilotSkill: values.pilotSkill.trim() || undefined,
      sensors,
      detectability: numOrUndefined(values.detectability),
      iconKey: values.iconKey,
      profileImageUrl: values.profileImageUrl.trim() || undefined,
      historicalNote: values.historicalNote.trim() || undefined,
      resistancePoints: numOrUndefined(values.resistancePoints),
      combatProfile: combatProfileToJson(combatProfile),
      weaponSystems: weaponSystemsToJson(weaponSystems),
      depthChargeStock: numOrUndefined(values.depthChargeStock),
      hedgehogStock: numOrUndefined(values.hedgehogStock),
      submergedRangeNmAt4kt: numOrUndefined(values.submergedRangeNmAt4kt),
      oxygenEnduranceHours: numOrUndefined(values.oxygenEnduranceHours),
      torpedoStock: numOrUndefined(values.torpedoStock),
      emergencyDiveSeconds: numOrUndefined(values.emergencyDiveSeconds),
      enduranceMinutes: numOrUndefined(values.enduranceMinutes),
      passive: values.passive,
    };

    startTransition(async () => {
      const res = await createLibraryClassAction(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated({
        id: res.id,
        key: payload.key,
        name: payload.name,
        nation: payload.nation,
        category: payload.category,
        theater: payload.theater ?? null,
        iconKey: values.iconKey,
      });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="chart-room-bg max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-800 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-brass-300">Nouvelle classe (rapide)</h2>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-300">
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Ajoutée à la bibliothèque partagée, réutilisable dans n&apos;importe quel scénario — mêmes champs que{" "}
          <span className="font-mono">/library/new</span>.
        </p>

        <div className="mt-4 space-y-5">
          <LibraryClassFields values={values} onChange={updateValues} />
          <section>
            <SensorsEditor value={sensors} onChange={setSensors} />
          </section>
          <section>
            <p className="mb-1 text-xs font-medium text-slate-400">Armement (laisser toutes les cases décochées si aucun)</p>
            <CombatProfileEditor value={combatProfile} onChange={setCombatProfile} />
          </section>
          <section>
            <WeaponSystemsEditor value={weaponSystems} onChange={setWeaponSystems} />
          </section>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            onClick={submit}
            disabled={isPending}
            className="rounded-md bg-brass-600 px-5 py-2.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
          >
            {isPending ? "Création…" : "Créer et utiliser"}
          </button>
          <button onClick={onClose} className="rounded-md border border-slate-700 px-5 py-2.5 text-sm hover:bg-slate-900">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
