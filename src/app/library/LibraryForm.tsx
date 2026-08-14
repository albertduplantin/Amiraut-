"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLibraryClassAction, updateLibraryClassAction } from "./actions";
import { LibraryClassFields, type LibraryClassFieldsValues } from "./LibraryClassFields";
import { SensorsEditor } from "./ArmamentEditor/SensorsEditor";
import { CombatProfileEditor } from "./ArmamentEditor/CombatProfileEditor";
import { WeaponSystemsEditor } from "./ArmamentEditor/WeaponSystemsEditor";
import {
  type Sensor,
  type CombatProfileValue,
  type WeaponSystemRow,
  sensorsFromJson,
  combatProfileFromJson,
  combatProfileToJson,
  weaponSystemsFromJson,
  weaponSystemsToJson,
} from "./ArmamentEditor/types";

export type LibraryClassData = {
  id?: string;
  key: string;
  name: string;
  nation: string;
  category: "SURFACE_SHIP" | "SUBMARINE" | "AIRCRAFT";
  maxSpeedKnots: number;
  lengthMeters: number | null;
  beamMeters: number | null;
  turningRadiusM: number | null;
  accelerationKnotsPerMin: number | null;
  agility: number | null;
  pilotSkill: string | null;
  sensors: unknown;
  detectability: number;
  iconKey: string;
  profileImageUrl: string | null;
  historicalNote: string | null;
  resistancePoints: number;
  combatProfile: unknown;
  weaponSystems: unknown;
  depthChargeStock: number | null;
  hedgehogStock: number | null;
  submergedRangeNmAt4kt: number | null;
  oxygenEnduranceHours: number | null;
  torpedoStock: number | null;
  emergencyDiveSeconds: number | null;
  enduranceMinutes: number | null;
  passive: boolean;
  theater: string | null;
};

function initialFieldValues(initial?: LibraryClassData): LibraryClassFieldsValues {
  return {
    key: initial?.key ?? "",
    name: initial?.name ?? "",
    nation: initial?.nation ?? "",
    category: initial?.category ?? "SURFACE_SHIP",
    theater: initial?.theater ?? "Atlantique/Arctique 1939-45",
    maxSpeedKnots: String(initial?.maxSpeedKnots ?? ""),
    lengthMeters: String(initial?.lengthMeters ?? ""),
    beamMeters: String(initial?.beamMeters ?? ""),
    turningRadiusM: String(initial?.turningRadiusM ?? ""),
    accelerationKnotsPerMin: String(initial?.accelerationKnotsPerMin ?? ""),
    agility: String(initial?.agility ?? ""),
    pilotSkill: initial?.pilotSkill ?? "",
    detectability: String(initial?.detectability ?? "1"),
    iconKey: initial?.iconKey ?? "cruiser",
    profileImageUrl: initial?.profileImageUrl ?? "",
    resistancePoints: String(initial?.resistancePoints ?? ""),
    historicalNote: initial?.historicalNote ?? "",
    passive: initial?.passive ?? false,
    enduranceMinutes: String(initial?.enduranceMinutes ?? ""),
    depthChargeStock: String(initial?.depthChargeStock ?? ""),
    hedgehogStock: String(initial?.hedgehogStock ?? ""),
    submergedRangeNmAt4kt: String(initial?.submergedRangeNmAt4kt ?? ""),
    oxygenEnduranceHours: String(initial?.oxygenEnduranceHours ?? ""),
    torpedoStock: String(initial?.torpedoStock ?? ""),
    emergencyDiveSeconds: String(initial?.emergencyDiveSeconds ?? ""),
  };
}

/**
 * Formulaire de classe de bibliothèque (navire ou avion) — création et
 * modification, voir /library. Entièrement visuel depuis le 2026-08-14
 * (retour utilisateur, chantier constructeur de scénario) : les 3
 * textareas JSON (capteurs, profil de combat, fiche d'armement) sont
 * remplacés par des éditeurs structurés — voir ArmamentEditor/. Le payload
 * final envoyé au serveur a exactement la même forme qu'avant, la
 * validation zod côté actions.ts est inchangée.
 */
export function LibraryForm({ initial }: { initial?: LibraryClassData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<LibraryClassFieldsValues>(() => initialFieldValues(initial));
  const [sensors, setSensors] = useState<Sensor[]>(() => {
    const existing = sensorsFromJson(initial?.sensors);
    if (existing.length > 0) return existing;
    // Nouvelle classe (pas de modification en cours) : un point de départ
    // plausible plutôt qu'une liste vide, sans forcer l'utilisateur à
    // deviner le format attendu — l'ancien exemple JSON servait le même but.
    return initial
      ? []
      : [
          { type: "RADAR", rangeNm: 15 },
          { type: "VISUAL", rangeNm: 12 },
        ];
  });
  const [combatProfile, setCombatProfile] = useState<CombatProfileValue>(() => combatProfileFromJson(initial?.combatProfile));
  const [weaponSystems, setWeaponSystems] = useState<WeaponSystemRow[]>(() => weaponSystemsFromJson(initial?.weaponSystems));

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
      const res = initial?.id ? await updateLibraryClassAction(initial.id, payload) : await createLibraryClassAction(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/library");
      router.refresh();
    });
  }

  return (
    <div className="chart-room-bg min-h-screen text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-2xl text-brass-300">{initial ? `Modifier — ${initial.name}` : "Nouvelle classe"}</h1>
        <p className="mt-1 text-sm text-slate-400">
          Navire ou avion réutilisable depuis n&apos;importe quel scénario (référencé par sa clé). Champs identiques à ceux
          d&apos;une classe définie directement dans un scénario.
        </p>

        <div className="mt-6 space-y-5">
          <LibraryClassFields values={values} onChange={updateValues} />

          <section>
            <SensorsEditor value={sensors} onChange={setSensors} />
          </section>

          <section>
            <p className="mb-1 text-xs font-medium text-slate-400">Armement (laisser toutes les cases décochées si aucun)</p>
            <CombatProfileEditor value={combatProfile} onChange={setCombatProfile} />
            <p className="mt-1 text-[11px] text-slate-600">
              Un même canon d&apos;avion sert aussi bien au combat air-air qu&apos;au mitraillage d&apos;un navire, selon la
              cible visée en jeu.
            </p>
          </section>

          <section>
            <WeaponSystemsEditor value={weaponSystems} onChange={setWeaponSystems} />
          </section>
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-8 flex gap-3">
          <button
            onClick={submit}
            disabled={isPending}
            className="rounded-md bg-brass-600 px-5 py-2.5 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
          >
            {isPending ? "Enregistrement…" : initial ? "Enregistrer les modifications" : "Créer la classe"}
          </button>
          <button onClick={() => router.push("/library")} className="rounded-md border border-slate-700 px-5 py-2.5 text-sm hover:bg-slate-900">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
