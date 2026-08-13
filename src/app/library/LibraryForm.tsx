"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLibraryClassAction, updateLibraryClassAction } from "./actions";

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
  sensors: unknown;
  detectability: number;
  iconKey: string;
  profileImageUrl: string | null;
  historicalNote: string | null;
  resistancePoints: number;
  combatProfile: unknown;
  weaponSystems: unknown;
  depthChargeStock: number | null;
  submergedRangeNmAt4kt: number | null;
  oxygenEnduranceHours: number | null;
  torpedoStock: number | null;
  enduranceMinutes: number | null;
  passive: boolean;
  theater: string | null;
};

const ICON_OPTIONS = ["battleship", "cruiser", "destroyer", "submarine", "aircraft", "cargo"];

function toJsonText(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

/** Formulaire de classe de bibliothèque (navire ou avion) — création et modification, voir /library. */
export function LibraryForm({ initial }: { initial?: LibraryClassData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [key, setKey] = useState(initial?.key ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [nation, setNation] = useState(initial?.nation ?? "");
  const [category, setCategory] = useState<"SURFACE_SHIP" | "SUBMARINE" | "AIRCRAFT">(initial?.category ?? "SURFACE_SHIP");
  const [theater, setTheater] = useState(initial?.theater ?? "Atlantique/Arctique 1939-45");
  const [maxSpeedKnots, setMaxSpeedKnots] = useState(String(initial?.maxSpeedKnots ?? ""));
  const [lengthMeters, setLengthMeters] = useState(String(initial?.lengthMeters ?? ""));
  const [beamMeters, setBeamMeters] = useState(String(initial?.beamMeters ?? ""));
  const [turningRadiusM, setTurningRadiusM] = useState(String(initial?.turningRadiusM ?? ""));
  const [accelerationKnotsPerMin, setAccelerationKnotsPerMin] = useState(String(initial?.accelerationKnotsPerMin ?? ""));
  const [agility, setAgility] = useState(String(initial?.agility ?? ""));
  const [detectability, setDetectability] = useState(String(initial?.detectability ?? "1"));
  const [iconKey, setIconKey] = useState(initial?.iconKey ?? "cruiser");
  const [profileImageUrl, setProfileImageUrl] = useState(initial?.profileImageUrl ?? "");
  const [resistancePoints, setResistancePoints] = useState(String(initial?.resistancePoints ?? ""));
  const [historicalNote, setHistoricalNote] = useState(initial?.historicalNote ?? "");
  const [passive, setPassive] = useState(initial?.passive ?? false);
  const [enduranceMinutes, setEnduranceMinutes] = useState(String(initial?.enduranceMinutes ?? ""));
  const [depthChargeStock, setDepthChargeStock] = useState(String(initial?.depthChargeStock ?? ""));
  const [submergedRangeNmAt4kt, setSubmergedRangeNmAt4kt] = useState(String(initial?.submergedRangeNmAt4kt ?? ""));
  const [oxygenEnduranceHours, setOxygenEnduranceHours] = useState(String(initial?.oxygenEnduranceHours ?? ""));
  const [torpedoStock, setTorpedoStock] = useState(String(initial?.torpedoStock ?? ""));

  const [sensorsText, setSensorsText] = useState(toJsonText(initial?.sensors, '[\n  { "type": "RADAR", "rangeNm": 15 },\n  { "type": "VISUAL", "rangeNm": 12 }\n]'));
  const [combatProfileText, setCombatProfileText] = useState(
    toJsonText(
      initial?.combatProfile,
      '{\n  "guns": [\n    { "calibreMm": 152, "count": 6, "rangeM": 23000, "roundsPerMinute": 8, "arc": "FORWARD" }\n  ]\n}'
    )
  );
  const [weaponSystemsText, setWeaponSystemsText] = useState(toJsonText(initial?.weaponSystems, '{\n  "mainGuns": "6 x 152mm"\n}'));

  const [sensorsError, setSensorsError] = useState<string | null>(null);
  const [combatProfileError, setCombatProfileError] = useState<string | null>(null);
  const [weaponSystemsError, setWeaponSystemsError] = useState<string | null>(null);

  function parseJsonField(text: string, setFieldError: (e: string | null) => void, optional: boolean): unknown {
    const trimmed = text.trim();
    if (!trimmed) {
      setFieldError(null);
      return optional ? undefined : trimmed;
    }
    try {
      const value = JSON.parse(trimmed);
      setFieldError(null);
      return value;
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : "JSON invalide");
      return undefined;
    }
  }

  function numOrUndefined(text: string): number | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }

  function submit() {
    setError(null);
    const sensors = parseJsonField(sensorsText, setSensorsError, false);
    const combatProfile = parseJsonField(combatProfileText, setCombatProfileError, true);
    const weaponSystems = parseJsonField(weaponSystemsText, setWeaponSystemsError, true);
    if (sensorsError || combatProfileError || weaponSystemsError) {
      setError("Corrigez les champs JSON en erreur avant d'enregistrer.");
      return;
    }

    const payload = {
      key: key.trim(),
      name: name.trim(),
      nation: nation.trim(),
      category,
      theater: theater.trim() || undefined,
      maxSpeedKnots: numOrUndefined(maxSpeedKnots),
      lengthMeters: numOrUndefined(lengthMeters),
      beamMeters: numOrUndefined(beamMeters),
      turningRadiusM: numOrUndefined(turningRadiusM),
      accelerationKnotsPerMin: numOrUndefined(accelerationKnotsPerMin),
      agility: numOrUndefined(agility),
      sensors,
      detectability: numOrUndefined(detectability),
      iconKey,
      profileImageUrl: profileImageUrl.trim() || undefined,
      historicalNote: historicalNote.trim() || undefined,
      resistancePoints: numOrUndefined(resistancePoints),
      combatProfile,
      weaponSystems,
      depthChargeStock: numOrUndefined(depthChargeStock),
      submergedRangeNmAt4kt: numOrUndefined(submergedRangeNmAt4kt),
      oxygenEnduranceHours: numOrUndefined(oxygenEnduranceHours),
      torpedoStock: numOrUndefined(torpedoStock),
      enduranceMinutes: numOrUndefined(enduranceMinutes),
      passive,
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

  const fieldClass = "mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm";
  const labelClass = "block text-xs font-medium text-slate-400";

  return (
    <div className="chart-room-bg min-h-screen text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-display text-2xl text-brass-300">{initial ? `Modifier — ${initial.name}` : "Nouvelle classe"}</h1>
        <p className="mt-1 text-sm text-slate-400">
          Navire ou avion réutilisable depuis n&apos;importe quel scénario (référencé par sa clé). Champs identiques à ceux
          d&apos;une classe définie directement dans un scénario.
        </p>

        <div className="mt-6 space-y-5">
          <section className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Clé (identifiant stable)
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ex: spitfire-mk-vb" className={fieldClass} />
            </label>
            <label className={labelClass}>
              Catégorie
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={fieldClass}>
                <option value="SURFACE_SHIP">Navire de surface</option>
                <option value="SUBMARINE">Sous-marin</option>
                <option value="AIRCRAFT">Avion</option>
              </select>
            </label>
            <label className={labelClass}>
              Nom
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Supermarine Spitfire Mk Vb" className={fieldClass} />
            </label>
            <label className={labelClass}>
              Nation
              <input value={nation} onChange={(e) => setNation(e.target.value)} placeholder="ex: Royaume-Uni" className={fieldClass} />
            </label>
            <label className={labelClass}>
              Théâtre (repère libre)
              <input value={theater} onChange={(e) => setTheater(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Icône carte
              <select value={iconKey} onChange={(e) => setIconKey(e.target.value)} className={fieldClass}>
                {ICON_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="grid grid-cols-3 gap-3">
            <label className={labelClass}>
              Vitesse max (nds)
              <input value={maxSpeedKnots} onChange={(e) => setMaxSpeedKnots(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Longueur (m)
              <input value={lengthMeters} onChange={(e) => setLengthMeters(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Largeur (m)
              <input value={beamMeters} onChange={(e) => setBeamMeters(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Rayon de giration (m)
              <input value={turningRadiusM} onChange={(e) => setTurningRadiusM(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Accélération (nds/min)
              <input value={accelerationKnotsPerMin} onChange={(e) => setAccelerationKnotsPerMin(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Détectabilité (×, 1 = neutre)
              <input value={detectability} onChange={(e) => setDetectability(e.target.value)} className={fieldClass} />
            </label>
            <label className={labelClass}>
              Résistance (potentiel de combat)
              <input value={resistancePoints} onChange={(e) => setResistancePoints(e.target.value)} className={fieldClass} />
            </label>
            {category === "AIRCRAFT" && (
              <>
                <label className={labelClass} title="Maniabilité en combat air-air, 0 à 1 — voir combat.ts">
                  Maniabilité air-air (0-1)
                  <input value={agility} onChange={(e) => setAgility(e.target.value)} className={fieldClass} />
                </label>
                <label className={labelClass}>
                  Autonomie de vol (min)
                  <input value={enduranceMinutes} onChange={(e) => setEnduranceMinutes(e.target.value)} className={fieldClass} />
                </label>
              </>
            )}
          </section>

          {category === "SUBMARINE" && (
            <section className="grid grid-cols-3 gap-3 rounded-md border border-slate-800 p-3">
              <p className="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Sous-marin</p>
              <label className={labelClass}>
                Autonomie immergée (nm à 4 nds)
                <input value={submergedRangeNmAt4kt} onChange={(e) => setSubmergedRangeNmAt4kt(e.target.value)} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Autonomie oxygène (h)
                <input value={oxygenEnduranceHours} onChange={(e) => setOxygenEnduranceHours(e.target.value)} className={fieldClass} />
              </label>
              <label className={labelClass}>
                Stock torpilles
                <input value={torpedoStock} onChange={(e) => setTorpedoStock(e.target.value)} className={fieldClass} />
              </label>
            </section>
          )}

          {category === "SURFACE_SHIP" && (
            <section className="grid grid-cols-3 gap-3 rounded-md border border-slate-800 p-3">
              <p className="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Escorteur (optionnel)</p>
              <label className={labelClass}>
                Stock grenades ASM
                <input value={depthChargeStock} onChange={(e) => setDepthChargeStock(e.target.value)} className={fieldClass} />
              </label>
            </section>
          )}

          <section>
            <label className={labelClass}>
              Capteurs (JSON — tableau {"{"}type, rangeNm{"}"})
              <textarea value={sensorsText} onChange={(e) => setSensorsText(e.target.value)} rows={4} className={`${fieldClass} font-mono text-xs`} />
            </label>
            {sensorsError && <p className="mt-1 text-xs text-red-400">{sensorsError}</p>}
          </section>

          <section>
            <label className={labelClass}>
              Profil de combat (JSON — guns / torpedoTubes / bombs, voir combat.ts). Laisser vide si aucun armement.
              <textarea
                value={combatProfileText}
                onChange={(e) => setCombatProfileText(e.target.value)}
                rows={6}
                className={`${fieldClass} font-mono text-xs`}
              />
            </label>
            {combatProfileError && <p className="mt-1 text-xs text-red-400">{combatProfileError}</p>}
            <p className="mt-1 text-[11px] text-slate-600">
              Avion torpilleur : <code>{`{"torpedoTubes":{"count":1,"rangeM":900,"speedKnots":40}}`}</code>. Bombardier :{" "}
              <code>{`{"bombs":{"count":1,"weightKg":250,"method":"DIVE"}}`}</code>. Chasseur :{" "}
              <code>{`{"guns":[{"calibreMm":20,"count":2,"rangeM":500,"roundsPerMinute":600,"arc":"FORWARD"}]}`}</code>.
            </p>
          </section>

          <section>
            <label className={labelClass}>
              Fiche d&apos;armement affichée aux joueurs (JSON libre, texte). Laisser vide si inutile.
              <textarea
                value={weaponSystemsText}
                onChange={(e) => setWeaponSystemsText(e.target.value)}
                rows={3}
                className={`${fieldClass} font-mono text-xs`}
              />
            </label>
            {weaponSystemsError && <p className="mt-1 text-xs text-red-400">{weaponSystemsError}</p>}
          </section>

          <section>
            <label className={labelClass}>
              Note historique
              <textarea value={historicalNote} onChange={(e) => setHistoricalNote(e.target.value)} rows={4} className={fieldClass} />
            </label>
          </section>

          <section>
            <label className={labelClass}>
              Silhouette de profil (URL, optionnel)
              <input value={profileImageUrl} onChange={(e) => setProfileImageUrl(e.target.value)} placeholder="/ships/spitfire.png" className={fieldClass} />
            </label>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={passive} onChange={(e) => setPassive(e.target.checked)} className="h-4 w-4" />
            Installation immobile (station d&apos;écoute, base fixe…) plutôt qu&apos;un navire/avion manoeuvrable
          </label>
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
