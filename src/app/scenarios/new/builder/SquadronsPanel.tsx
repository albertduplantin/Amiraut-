"use client";

import type { BuilderSquadron, BuilderAirbase, BuilderUnit } from "./types";

const fieldClass = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs";

function baseRefToOptionValue(ref: BuilderSquadron["baseRef"]): string {
  if (ref.kind === "none") return "none";
  if (ref.kind === "airbase") return `airbase:${ref.key}`;
  return `carrier:${ref.unitName}`;
}

/**
 * Escadrilles (retour utilisateur 2026-08-14, recherche historique
 * §4.1.1.1 Amirauté 2013) : conteneur au même niveau que les task forces —
 * une base aérienne OU un porte-avions, jamais les deux (voir
 * ScenarioSquadron). Les avions rejoignent une escadrille via leur propre
 * sélecteur de base (voir UnitRosterRow) — ce panneau se contente
 * d'afficher qui en est déjà membre, en lecture seule.
 */
export function SquadronsPanel({
  squadrons,
  airbases,
  carrierCandidates,
  memberCountByKey,
  onAdd,
  onUpdate,
  onRemove,
}: {
  squadrons: BuilderSquadron[];
  airbases: BuilderAirbase[];
  carrierCandidates: BuilderUnit[];
  memberCountByKey: Map<string, number>;
  onAdd: () => void;
  onUpdate: (clientId: string, patch: Partial<BuilderSquadron>) => void;
  onRemove: (clientId: string) => void;
}) {
  function handleBaseSelect(clientId: string, optionValue: string) {
    if (optionValue === "none") return onUpdate(clientId, { baseRef: { kind: "none" } });
    const sep = optionValue.indexOf(":");
    const kind = optionValue.slice(0, sep);
    const ref = optionValue.slice(sep + 1);
    if (kind === "airbase") onUpdate(clientId, { baseRef: { kind: "airbase", key: ref } });
    else if (kind === "carrier") onUpdate(clientId, { baseRef: { kind: "carrier", unitName: ref } });
  }

  return (
    <div className="panel-brass space-y-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm text-brass-300">Escadrilles</h3>
        <button type="button" onClick={onAdd} className="text-xs text-brass-400 hover:text-brass-300">
          + Nouvelle escadrille
        </button>
      </div>
      <p className="text-[11px] text-slate-600">
        Regroupe des avions qui partagent une même base — pas les avions de reconnaissance ou d&apos;attaque navale isolée,
        rattachés directement (voir chaque avion dans sa task force).
      </p>
      {squadrons.length === 0 && <p className="text-xs text-slate-600">Aucune escadrille.</p>}
      <ul className="space-y-2">
        {squadrons.map((s) => (
          <li key={s.clientId} className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={s.name} onChange={(e) => onUpdate(s.clientId, { name: e.target.value })} placeholder="Nom (ex: Escadrille Alpha)" className={`${fieldClass} min-w-[8rem] flex-1`} />
              <input value={s.key} onChange={(e) => onUpdate(s.clientId, { key: e.target.value })} placeholder="clé" className={`${fieldClass} w-24`} title="Clé stable, référencée par les avions membres" />
              <button type="button" onClick={() => onRemove(s.clientId)} className="ml-auto text-xs text-red-500 hover:text-red-400">
                Supprimer
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-1.5">
              <span className="text-[11px] text-slate-500">Base :</span>
              <select value={baseRefToOptionValue(s.baseRef)} onChange={(e) => handleBaseSelect(s.clientId, e.target.value)} className={fieldClass}>
                <option value="none">Aucune (pas encore décidée)</option>
                {airbases.map((a) => (
                  <option key={a.clientId} value={`airbase:${a.key}`}>
                    Base aérienne : {a.name || a.key}
                  </option>
                ))}
                {carrierCandidates.map((c) => (
                  <option key={c.clientId} value={`carrier:${c.name}`}>
                    Porte-avions : {c.name}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-slate-500">{memberCountByKey.get(s.key) ?? 0} avion(s) membre(s)</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
