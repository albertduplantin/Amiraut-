"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  selectGunBattery,
  gunHitChancePercent,
  selectTorpedoBattery,
  torpedoHitChancePercent,
  type CombatProfile,
} from "@/lib/combat";
import { assessFiringReveal } from "@/lib/tacticalNarrative";
import { submitMovementAction, submitFireAction, sendBattleChatAction } from "./actions";

type OwnUnit = {
  id: string;
  name: string;
  className: string;
  category: string;
  combatProfile: CombatProfile | null;
  maxSpeedKnots: number;
  healthCurrent: number | null;
  healthMax: number | null;
  status: string;
  headingDeg: number | null;
  depthBand: string;
  batteryChargePercent: number | null;
  oxygenHoursRemaining: number | null;
  oxygenEnduranceHours: number | null;
  torpedoesRemaining: number | null;
};

type Contact = {
  targetUnitId: string;
  name: string;
  className: string;
  category: string;
  lengthMeters: number | null;
  beamMeters: number | null;
  maxSpeedKnots: number;
  method: string;
  distanceNm: number;
  bearingDeg: number;
  status: string;
};

type OwnAction = {
  unitId: string;
  phase: string;
  headingDeg: number | null;
  speedKnots: number | null;
  depthBand: string | null;
  targetUnitId: string | null;
  weaponType: string | null;
  torpedoTypeId: string | null;
  resolved: boolean;
  hit: boolean | null;
  hits: number | null;
  damagePoints: number | null;
  targetSunk: boolean | null;
  narrative: string | null;
};

type BattleMessage = { id: string; kind: string; authorName: string; body: string; roundNumber: number; teamId: string | null };

type LogEntry = {
  roundNumber: number;
  unitId: string;
  targetUnitId: string | null;
  weaponType: string | null;
  hit: boolean | null;
  hits: number | null;
  damagePoints: number | null;
  targetSunk: boolean | null;
  narrative: string | null;
};

const NM_TO_M = 1852;
const ASSUMED_TARGET_SPEED_RATIO = 0.7;

export function BattleClient(props: {
  engagementId: string;
  status: string;
  roundNumber: number;
  roundMinutes: number;
  syncMode: string;
  arbiterPaused: boolean;
  endReason: string | null;
  teamId: string;
  teams: { id: string; name: string }[];
  submittedTeamIds: string[];
  ownUnits: OwnUnit[];
  contacts: Contact[];
  ownActions: OwnAction[];
  battleLog: LogEntry[];
  messages: BattleMessage[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chatBody, setChatBody] = useState("");

  const [moves, setMoves] = useState<Record<string, { headingDeg: number; speedKnots: number; depthBand?: string }>>(() => {
    const init: Record<string, { headingDeg: number; speedKnots: number; depthBand?: string }> = {};
    for (const u of props.ownUnits) {
      const prior = props.ownActions.find((a) => a.unitId === u.id && a.phase === "MOVEMENT");
      init[u.id] = { headingDeg: prior?.headingDeg ?? u.headingDeg ?? 0, speedKnots: prior?.speedKnots ?? 0, depthBand: prior?.depthBand ?? undefined };
    }
    return init;
  });

  const [shots, setShots] = useState<Record<string, { targetUnitId: string; weaponType: "GUN" | "TORPEDO"; torpedoTypeId?: string }>>({});

  // Rafraîchit automatiquement en attendant l'autre camp, pour un rendu
  // « synchrone » sans que le joueur ait à recharger la page.
  const hasSubmittedThisPhase = props.submittedTeamIds.includes(props.teamId);
  useEffect(() => {
    if (props.status === "RESOLVED") return;
    if (!hasSubmittedThisPhase) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [hasSubmittedThisPhase, props.status, router]);

  function submitMovement() {
    setError(null);
    startTransition(async () => {
      const result = await submitMovementAction({
        engagementId: props.engagementId,
        moves: props.ownUnits
          .filter((u) => u.status !== "SUNK")
          .map((u) => ({
            unitId: u.id,
            headingDeg: moves[u.id]?.headingDeg ?? 0,
            speedKnots: moves[u.id]?.speedKnots ?? 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            depthBand: (moves[u.id]?.depthBand as any) ?? undefined,
          })),
      });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function submitFire() {
    setError(null);
    startTransition(async () => {
      const chosen = props.ownUnits
        .filter((u) => u.status !== "SUNK" && shots[u.id]?.targetUnitId)
        .map((u) => ({
          unitId: u.id,
          targetUnitId: shots[u.id].targetUnitId,
          weaponType: shots[u.id].weaponType,
          torpedoTypeId: shots[u.id].torpedoTypeId,
        }));
      const result = await submitFireAction({ engagementId: props.engagementId, shots: chosen });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function sendChat() {
    if (!chatBody.trim()) return;
    startTransition(async () => {
      await sendBattleChatAction({ engagementId: props.engagementId, body: chatBody });
      setChatBody("");
      router.refresh();
    });
  }

  if (props.status === "RESOLVED") {
    return (
      <div className="chart-room-bg flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-slate-100">
        <h1 className="font-display text-2xl text-brass-300">Combat terminé</h1>
        <p className="text-slate-400">{formatEndReason(props.endReason)}</p>
        <Link href="/team/orders" className="rounded-md bg-brass-600 px-4 py-2 font-medium hover:bg-brass-500">
          Retour aux ordres
        </Link>
      </div>
    );
  }

  return (
    <div className="chart-room-bg flex h-screen w-full flex-col text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <div>
          <h1 className="font-display text-lg tracking-wide text-brass-300">
            Bataille tactique — manche {props.roundNumber}
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({props.roundMinutes} min · {props.syncMode === "SYNC" ? "synchrone" : "asynchrone"})
            </span>
          </h1>
          <p className="text-xs text-slate-500">
            Phase : {props.status === "AWAITING_MOVEMENT" ? "mouvement" : "tir"}
            {props.arbiterPaused && <span className="ml-2 text-amber-400">⏸ suspendu par l&apos;arbitre</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {props.teams.map((t) => (
            <span
              key={t.id}
              className={`rounded px-2 py-1 ${
                props.submittedTeamIds.includes(t.id) ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-800 text-slate-400"
              }`}
            >
              {t.name} {props.submittedTeamIds.includes(t.id) ? "✓ prêt" : "…"}
            </span>
          ))}
        </div>
        <Link href="/team/orders" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
          Retour aux ordres
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4">
          {props.arbiterPaused ? (
            <p className="rounded-md border border-amber-800 bg-amber-950/30 p-4 text-amber-200">
              L&apos;arbitre a suspendu le combat. Attendez qu&apos;il le relance.
            </p>
          ) : hasSubmittedThisPhase ? (
            <div className="rounded-md border border-emerald-800 bg-emerald-950/20 p-4">
              <p className="text-emerald-300">Ordres soumis. En attente de l&apos;autre camp…</p>
              <p className="mt-1 text-xs text-slate-500">Cette page se rafraîchit toute seule.</p>
            </div>
          ) : props.status === "AWAITING_MOVEMENT" ? (
            <MovementPhase ownUnits={props.ownUnits} moves={moves} setMoves={setMoves} onSubmit={submitMovement} pending={isPending} />
          ) : (
            <FirePhase
              ownUnits={props.ownUnits}
              contacts={props.contacts}
              shots={shots}
              setShots={setShots}
              onSubmit={submitFire}
              pending={isPending}
            />
          )}
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {props.battleLog.length > 0 && (
            <div className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-3">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Journal de combat</h2>
              <ul className="space-y-2 text-sm">
                {props.battleLog
                  .filter((a) => a.narrative)
                  .map((a, i) => (
                    <li key={i} className={`rounded-md px-3 py-2 ${a.hit ? "bg-red-950/40" : "bg-slate-800/60"}`}>
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-500">Manche {a.roundNumber}</div>
                      {a.narrative}
                      {a.hit && (
                        <div className="mt-1 text-xs text-slate-400">
                          {a.hits} impact{(a.hits ?? 0) > 1 ? "s" : ""} · {a.damagePoints?.toFixed(1)} pts
                          {a.targetSunk && <span className="text-red-400"> · coulé</span>}
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800 p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Communications</h2>
          <div className="mb-2 max-h-[60vh] space-y-1 overflow-y-auto text-xs">
            {props.messages.length === 0 && <p className="text-slate-600">Aucun message.</p>}
            {props.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded px-2 py-1 ${
                  m.kind === "ARBITER_EVENT"
                    ? "bg-orange-950/40 text-orange-200"
                    : m.kind === "SYSTEM"
                      ? "bg-slate-800/60 text-slate-400"
                      : "bg-slate-800 text-slate-200"
                }`}
              >
                <span className="font-medium">{m.authorName}</span> (T{m.roundNumber}) : {m.body}
              </div>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              value={chatBody}
              onChange={(e) => setChatBody(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Message…"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
            />
            <button onClick={sendChat} className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
              Envoyer
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MovementPhase({
  ownUnits,
  moves,
  setMoves,
  onSubmit,
  pending,
}: {
  ownUnits: OwnUnit[];
  moves: Record<string, { headingDeg: number; speedKnots: number; depthBand?: string }>;
  setMoves: React.Dispatch<React.SetStateAction<Record<string, { headingDeg: number; speedKnots: number; depthBand?: string }>>>;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Cap et vitesse pour cette manche. De nouveaux contacts peuvent apparaître à l&apos;issue du mouvement — des deux côtés.
      </p>
      {ownUnits
        .filter((u) => u.status !== "SUNK")
        .map((u) => (
          <div key={u.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-slate-500">{u.className}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block">
                Cap : {moves[u.id]?.headingDeg ?? 0}°
                <input
                  type="range"
                  min={0}
                  max={359}
                  value={moves[u.id]?.headingDeg ?? 0}
                  onChange={(e) => setMoves((p) => ({ ...p, [u.id]: { ...p[u.id], headingDeg: Number(e.target.value) } }))}
                  className="mt-1 w-full"
                />
              </label>
              <label className="block">
                Vitesse : {moves[u.id]?.speedKnots ?? 0} nds (max {u.maxSpeedKnots})
                <input
                  type="range"
                  min={0}
                  max={u.maxSpeedKnots}
                  value={moves[u.id]?.speedKnots ?? 0}
                  onChange={(e) => setMoves((p) => ({ ...p, [u.id]: { ...p[u.id], speedKnots: Number(e.target.value) } }))}
                  className="mt-1 w-full"
                />
              </label>
            </div>
          </div>
        ))}
      <button
        onClick={onSubmit}
        disabled={pending}
        className="w-full rounded-md bg-brass-600 px-3 py-2 font-medium hover:bg-brass-500 disabled:opacity-50"
      >
        {pending ? "Envoi…" : "Valider le mouvement"}
      </button>
    </div>
  );
}

function FirePhase({
  ownUnits,
  contacts,
  shots,
  setShots,
  onSubmit,
  pending,
}: {
  ownUnits: OwnUnit[];
  contacts: Contact[];
  shots: Record<string, { targetUnitId: string; weaponType: "GUN" | "TORPEDO"; torpedoTypeId?: string }>;
  setShots: React.Dispatch<React.SetStateAction<Record<string, { targetUnitId: string; weaponType: "GUN" | "TORPEDO"; torpedoTypeId?: string }>>>;
  onSubmit: () => void;
  pending: boolean;
}) {
  const liveContacts = contacts.filter((c) => c.status !== "SUNK");

  return (
    <div className="space-y-3">
      {liveContacts.length === 0 ? (
        <p className="rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
          Aucun contact détecté ce round : rien à engager. Validez pour passer à la manche suivante.
        </p>
      ) : (
        <p className="text-sm text-slate-400">On ne peut tirer que sur ce qui a été détecté à l&apos;issue du mouvement.</p>
      )}

      {ownUnits
        .filter((u) => u.status !== "SUNK")
        .map((u) => (
          <ShooterCard key={u.id} unit={u} contacts={liveContacts} shot={shots[u.id]} setShots={setShots} />
        ))}

      <button
        onClick={onSubmit}
        disabled={pending}
        className="w-full rounded-md bg-red-800 px-3 py-2 font-medium hover:bg-red-700 disabled:opacity-50"
      >
        {pending ? "Envoi…" : "Valider les tirs"}
      </button>
    </div>
  );
}

function ShooterCard({
  unit,
  contacts,
  shot,
  setShots,
}: {
  unit: OwnUnit;
  contacts: Contact[];
  shot: { targetUnitId: string; weaponType: "GUN" | "TORPEDO"; torpedoTypeId?: string } | undefined;
  setShots: React.Dispatch<React.SetStateAction<Record<string, { targetUnitId: string; weaponType: "GUN" | "TORPEDO"; torpedoTypeId?: string }>>>;
}) {
  const hasGuns = (unit.combatProfile?.guns?.length ?? 0) > 0;
  const hasTorpedoes = !!unit.combatProfile?.torpedoTubes;
  const torpedoTypes = unit.combatProfile?.torpedoTypes ?? null;
  const target = contacts.find((c) => c.targetUnitId === shot?.targetUnitId) ?? null;

  const estimate = useMemo(() => {
    if (!target) return { gunChance: null as number | null, torpedoChance: null as number | null, calibre: null as number | null };
    const rangeM = target.distanceNm * NM_TO_M;
    const targetLengthM = target.lengthMeters ?? 100;
    const targetBeamM = target.beamMeters ?? 12;
    const assumedSpeed = target.maxSpeedKnots * ASSUMED_TARGET_SPEED_RATIO;

    const battery = selectGunBattery(unit.combatProfile, rangeM);
    const gunChance = battery
      ? gunHitChancePercent({ calibreMm: battery.calibreMm, rangeM, maxRangeM: battery.rangeM, targetLengthM, targetBeamM, targetSpeedKnots: assumedSpeed })
      : null;

    const torpBattery = selectTorpedoBattery(unit.combatProfile, shot?.torpedoTypeId);
    const torpedoChance =
      torpBattery && rangeM <= torpBattery.rangeM
        ? torpedoHitChancePercent({
            rangeM,
            maxRangeM: torpBattery.rangeM,
            torpedoSpeedKnots: torpBattery.speedKnots,
            targetLengthM,
            targetBeamM,
            targetSpeedKnots: assumedSpeed,
            angleOfAttackDeg: 45,
          })
        : null;

    return { gunChance, torpedoChance, calibre: battery?.calibreMm ?? null };
  }, [target, unit.combatProfile, shot?.torpedoTypeId]);

  const reveal = shot?.weaponType
    ? assessFiringReveal({
        weaponType: shot.weaponType,
        calibreMm: estimate.calibre,
        torpedoWakeVisible: torpedoTypes?.find((t) => t.id === shot.torpedoTypeId)?.wakeVisible ?? true,
        isNight: false,
      })
    : null;

  if (!hasGuns && !hasTorpedoes) return null;

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
      <div className="mb-2 font-medium">{unit.name}</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          Cible
          <select
            value={shot?.targetUnitId ?? ""}
            onChange={(e) =>
              setShots((p) => ({ ...p, [unit.id]: { targetUnitId: e.target.value, weaponType: p[unit.id]?.weaponType ?? "GUN" } }))
            }
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
          >
            <option value="">— aucune —</option>
            {contacts.map((c) => (
              <option key={c.targetUnitId} value={c.targetUnitId}>
                {c.className} — {c.distanceNm.toFixed(1)}nm, gis. {Math.round(c.bearingDeg)}°
              </option>
            ))}
          </select>
        </label>
        <label>
          Arme
          <select
            value={shot?.weaponType ?? "GUN"}
            onChange={(e) =>
              setShots((p) => ({ ...p, [unit.id]: { targetUnitId: p[unit.id]?.targetUnitId ?? "", weaponType: e.target.value as "GUN" | "TORPEDO" } }))
            }
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
          >
            {hasGuns && <option value="GUN">Canon</option>}
            {hasTorpedoes && <option value="TORPEDO">Torpille</option>}
          </select>
        </label>
      </div>

      {shot?.weaponType === "TORPEDO" && torpedoTypes && torpedoTypes.length > 0 && (
        <div className="mt-2 flex gap-1">
          {torpedoTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => setShots((p) => ({ ...p, [unit.id]: { ...p[unit.id], torpedoTypeId: t.id } }))}
              className={`flex-1 rounded px-2 py-1 text-[11px] ${
                shot?.torpedoTypeId === t.id ? "bg-brass-900/50 ring-1 ring-brass-500" : "border border-slate-700 hover:bg-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {target && shot?.weaponType && (
        <div className="mt-2 rounded bg-slate-950/60 p-2 text-[11px]">
          {shot.weaponType === "GUN" &&
            (estimate.gunChance !== null ? <div>Chance de toucher : ~{estimate.gunChance.toFixed(0)}%</div> : <div className="text-slate-500">Hors de portée.</div>)}
          {shot.weaponType === "TORPEDO" &&
            (estimate.torpedoChance !== null ? (
              <div>Chance de toucher : ~{estimate.torpedoChance.toFixed(0)}%</div>
            ) : (
              <div className="text-slate-500">Hors de portée.</div>
            ))}
          {reveal && reveal.revealRadiusNm > 0 && (
            <div className="mt-0.5 text-amber-400">⚠ {reveal.label} — {reveal.reason}</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatEndReason(reason: string | null) {
  switch (reason) {
    case "ALL_ENEMIES_SUNK":
      return "L'adversaire a été anéanti ou s'est retiré.";
    case "CONTACT_LOST":
      return "Le contact a été rompu.";
    case "OUT_OF_AMMUNITION":
      return "Plus aucun camp n'a de quoi tirer.";
    case "ARBITER_ENDED":
      return "L'arbitre a mis fin au combat.";
    case "DISENGAGED":
      return "Rupture de contact volontaire.";
    default:
      return "Combat terminé.";
  }
}
