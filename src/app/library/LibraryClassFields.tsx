"use client";

const ICON_OPTIONS = ["battleship", "cruiser", "destroyer", "submarine", "aircraft", "cargo"];

/**
 * Champs scalaires généraux d'une classe de bibliothèque (identité,
 * mouvement, spécificités par catégorie) — extrait de LibraryForm.tsx le
 * 2026-08-14 pour être réutilisable par la modal de création rapide
 * depuis le constructeur de scénario (voir QuickCreateClassModal.tsx).
 * Toujours contrôlé depuis le parent : cette fonction ne détient aucun
 * état, uniquement des champs texte (mêmes conversions numériques qu'avant
 * à l'assemblage du payload, côté appelant).
 */
export type LibraryClassFieldsValues = {
  key: string;
  name: string;
  nation: string;
  category: "SURFACE_SHIP" | "SUBMARINE" | "AIRCRAFT";
  theater: string;
  maxSpeedKnots: string;
  lengthMeters: string;
  beamMeters: string;
  turningRadiusM: string;
  accelerationKnotsPerMin: string;
  agility: string;
  pilotSkill: string;
  detectability: string;
  iconKey: string;
  profileImageUrl: string;
  resistancePoints: string;
  historicalNote: string;
  passive: boolean;
  enduranceMinutes: string;
  depthChargeStock: string;
  hedgehogStock: string;
  submergedRangeNmAt4kt: string;
  oxygenEnduranceHours: string;
  torpedoStock: string;
  emergencyDiveSeconds: string;
};

const fieldClass = "mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm";
const labelClass = "block text-xs font-medium text-slate-400";

export function LibraryClassFields({
  values,
  onChange,
}: {
  values: LibraryClassFieldsValues;
  onChange: (patch: Partial<LibraryClassFieldsValues>) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Clé (identifiant stable)
          <input value={values.key} onChange={(e) => onChange({ key: e.target.value })} placeholder="ex: spitfire-mk-vb" className={fieldClass} />
        </label>
        <label className={labelClass}>
          Catégorie
          <select
            value={values.category}
            onChange={(e) => onChange({ category: e.target.value as LibraryClassFieldsValues["category"] })}
            className={fieldClass}
          >
            <option value="SURFACE_SHIP">Navire de surface</option>
            <option value="SUBMARINE">Sous-marin</option>
            <option value="AIRCRAFT">Avion</option>
          </select>
        </label>
        <label className={labelClass}>
          Nom
          <input value={values.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="ex: Supermarine Spitfire Mk Vb" className={fieldClass} />
        </label>
        <label className={labelClass}>
          Nation
          <input value={values.nation} onChange={(e) => onChange({ nation: e.target.value })} placeholder="ex: Royaume-Uni" className={fieldClass} />
        </label>
        <label className={labelClass}>
          Théâtre (repère libre)
          <input value={values.theater} onChange={(e) => onChange({ theater: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Icône carte
          <select value={values.iconKey} onChange={(e) => onChange({ iconKey: e.target.value })} className={fieldClass}>
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
          <input value={values.maxSpeedKnots} onChange={(e) => onChange({ maxSpeedKnots: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Longueur (m)
          <input value={values.lengthMeters} onChange={(e) => onChange({ lengthMeters: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Largeur (m)
          <input value={values.beamMeters} onChange={(e) => onChange({ beamMeters: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Rayon de giration (m)
          <input value={values.turningRadiusM} onChange={(e) => onChange({ turningRadiusM: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Accélération (nds/min)
          <input value={values.accelerationKnotsPerMin} onChange={(e) => onChange({ accelerationKnotsPerMin: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Détectabilité (×, 1 = neutre)
          <input value={values.detectability} onChange={(e) => onChange({ detectability: e.target.value })} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Résistance (potentiel de combat)
          <input value={values.resistancePoints} onChange={(e) => onChange({ resistancePoints: e.target.value })} className={fieldClass} />
        </label>
        {values.category === "AIRCRAFT" && (
          <>
            <label className={labelClass} title="Maniabilité en combat air-air, 0 à 1 — voir combat.ts">
              Maniabilité air-air (0-1)
              <input value={values.agility} onChange={(e) => onChange({ agility: e.target.value })} className={fieldClass} />
            </label>
            <label className={labelClass} title="A (élite) à F (très mauvais) — moyen (C) si laissé vide, voir combat.ts pilotSkillMultiplier">
              Niveau équipage (A-F)
              <input
                value={values.pilotSkill}
                onChange={(e) => onChange({ pilotSkill: e.target.value.toUpperCase().slice(0, 1) })}
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              Autonomie de vol (min)
              <input value={values.enduranceMinutes} onChange={(e) => onChange({ enduranceMinutes: e.target.value })} className={fieldClass} />
            </label>
          </>
        )}
      </section>

      {values.category === "SUBMARINE" && (
        <section className="grid grid-cols-3 gap-3 rounded-md border border-slate-800 p-3">
          <p className="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Sous-marin</p>
          <label className={labelClass}>
            Autonomie immergée (nm à 4 nds)
            <input value={values.submergedRangeNmAt4kt} onChange={(e) => onChange({ submergedRangeNmAt4kt: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Autonomie oxygène (h)
            <input value={values.oxygenEnduranceHours} onChange={(e) => onChange({ oxygenEnduranceHours: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass}>
            Stock torpilles
            <input value={values.torpedoStock} onChange={(e) => onChange({ torpedoStock: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass} title="Recherche 2026-08-14 : ~30s U-Boote, ~45s japonais/américains, ~60s britanniques/italiens">
            Plongée d&apos;urgence (s)
            <input value={values.emergencyDiveSeconds} onChange={(e) => onChange({ emergencyDiveSeconds: e.target.value })} className={fieldClass} />
          </label>
        </section>
      )}

      {values.category === "SURFACE_SHIP" && (
        <section className="grid grid-cols-3 gap-3 rounded-md border border-slate-800 p-3">
          <p className="col-span-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Escorteur (optionnel)</p>
          <label className={labelClass}>
            Stock grenades ASM
            <input value={values.depthChargeStock} onChange={(e) => onChange({ depthChargeStock: e.target.value })} className={fieldClass} />
          </label>
          <label className={labelClass} title="Une salve = une gerbe de 24 projectiles, comptée comme une seule recharge — voir combat.ts">
            Salves Hedgehog
            <input value={values.hedgehogStock} onChange={(e) => onChange({ hedgehogStock: e.target.value })} className={fieldClass} />
          </label>
        </section>
      )}

      <section>
        <label className={labelClass}>
          Note historique
          <textarea value={values.historicalNote} onChange={(e) => onChange({ historicalNote: e.target.value })} rows={4} className={fieldClass} />
        </label>
      </section>

      <section>
        <label className={labelClass}>
          Silhouette de profil (URL, optionnel)
          <input
            value={values.profileImageUrl}
            onChange={(e) => onChange({ profileImageUrl: e.target.value })}
            placeholder="/ships/spitfire.png"
            className={fieldClass}
          />
        </label>
      </section>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.passive} onChange={(e) => onChange({ passive: e.target.checked })} className="h-4 w-4" />
        Installation immobile (station d&apos;écoute, base fixe…) plutôt qu&apos;un navire/avion manoeuvrable
      </label>
    </div>
  );
}
