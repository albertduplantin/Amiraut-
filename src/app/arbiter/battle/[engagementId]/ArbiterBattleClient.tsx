"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  toggleArbiterPauseAction,
  sendArbiterEventAction,
  arbiterAdjustUnitAction,
  arbiterEndEngagementAction,
} from "./actions";

type Participant = {
  unitId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  name: string;
  className: string;
  status: string;
  healthCurrent: number | null;
  healthMax: number | null;
  depthBand: string;
};

type ActionRow = {
  unitName: string;
  targetName: string | null;
  phase: string;
  weaponType: string | null;
  resolved: boolean;
  hit: boolean | null;
  narrative: string | null;
};

type Message = { id: string; kind: string; authorName: string; body: string; roundNumber: number };

export function ArbiterBattleClient(props: {
  engagementId: string;
  status: string;
  roundNumber: number;
  roundMinutes: number;
  arbiterPaused: boolean;
  endReason: string | null;
  teams: { id: string; name: string }[];
  submittedTeamIds: string[];
  participants: Participant[];
  actions: ActionRow[];
  messages: Message[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [eventBody, setEventBody] = useState("");
  const [adjustUnitId, setAdjustUnitId] = useState(props.participants[0]?.unitId ?? "");
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustNote, setAdjustNote] = useState("");

  // Vue temps réel : rafraîchit tant que le combat n'est pas terminé.
  useEffect(() => {
    if (props.status === "RESOLVED") return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [props.status, router]);

  function togglePause() {
    startTransition(async () => {
      await toggleArbiterPauseAction({ engagementId: props.engagementId, paused: !props.arbiterPaused });
      router.refresh();
    });
  }

  function sendEvent() {
    if (!eventBody.trim()) return;
    startTransition(async () => {
      await sendArbiterEventAction({ engagementId: props.engagementId, body: eventBody });
      setEventBody("");
      router.refresh();
    });
  }

  function applyAdjust() {
    if (!adjustNote.trim() || !adjustUnitId) return;
    startTransition(async () => {
      await arbiterAdjustUnitAction({
        engagementId: props.engagementId,
        unitId: adjustUnitId,
        healthDelta: adjustDelta,
        note: adjustNote,
      });
      setAdjustNote("");
      setAdjustDelta(0);
      router.refresh();
    });
  }

  function endNow() {
    startTransition(async () => {
      await arbiterEndEngagementAction({ engagementId: props.engagementId });
      router.refresh();
    });
  }

  const byTeam = new Map<string, Participant[]>();
  for (const p of props.participants) {
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }

  return (
    <div className="chart-room-bg min-h-screen p-6 text-slate-100">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl tracking-wide text-brass-300">
            Bataille tactique — manche {props.roundNumber}
          </h1>
          <p className="text-sm text-slate-400">
            Phase : {props.status === "AWAITING_MOVEMENT" ? "mouvement" : props.status === "AWAITING_FIRE" ? "tir" : "terminée"}
            {" · "}
            {props.roundMinutes} min/manche
            {props.status === "RESOLVED" && <span className="ml-2 text-red-400">({formatEndReason(props.endReason)})</span>}
          </p>
        </div>
        <Link href="/arbiter" className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-900">
          Tableau de bord
        </Link>
      </div>

      {props.status !== "RESOLVED" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={togglePause}
            disabled={isPending}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              props.arbiterPaused ? "bg-emerald-700 hover:bg-emerald-600" : "bg-amber-800 hover:bg-amber-700"
            }`}
          >
            {props.arbiterPaused ? "▶ Relancer" : "⏸ Suspendre"}
          </button>
          <button onClick={endNow} disabled={isPending} className="rounded-md bg-red-900 px-3 py-1.5 text-sm font-medium hover:bg-red-800">
            Mettre fin au combat
          </button>
          <div className="flex gap-1 text-xs">
            {props.teams.map((t) => (
              <span
                key={t.id}
                className={`rounded px-2 py-1 ${
                  props.submittedTeamIds.includes(t.id) ? "bg-emerald-900/60 text-emerald-300" : "bg-slate-800 text-slate-400"
                }`}
              >
                {t.name} {props.submittedTeamIds.includes(t.id) ? "✓" : "…"}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          {Array.from(byTeam.entries()).map(([teamId, units]) => (
            <div key={teamId} className="rounded-md border border-slate-800 bg-slate-900 p-3">
              <h2 className="mb-2 text-sm font-semibold" style={{ color: units[0].teamColor }}>
                {units[0].teamName}
              </h2>
              <table className="w-full text-xs">
                <tbody>
                  {units.map((u) => {
                    const ratio = u.healthMax && u.healthMax > 0 ? (u.healthCurrent ?? 0) / u.healthMax : null;
                    return (
                      <tr key={u.unitId} className="border-t border-slate-800">
                        <td className="py-1 pr-2">{u.name}</td>
                        <td className="py-1 pr-2 text-slate-500">{u.className}</td>
                        <td className="py-1 pr-2 text-slate-500">{u.depthBand !== "SURFACE" && formatDepth(u.depthBand)}</td>
                        <td className="w-24 py-1">
                          {ratio !== null && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                              <div className={`h-full ${ratio < 0.6 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${ratio * 100}%` }} />
                            </div>
                          )}
                        </td>
                        <td className={`py-1 pl-2 text-right ${u.status === "SUNK" ? "text-red-400" : u.status === "DAMAGED" ? "text-amber-400" : "text-slate-500"}`}>
                          {u.status === "SUNK" ? "coulé" : u.status === "DAMAGED" ? "endommagé" : "actif"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-400">Actions de la manche {props.roundNumber}</h2>
            {props.actions.length === 0 ? (
              <p className="text-xs text-slate-600">Aucune action pour l&apos;instant.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {props.actions.map((a, i) => (
                  <li key={i} className={`rounded px-2 py-1 ${a.hit ? "bg-red-950/40" : "bg-slate-950/40"}`}>
                    {a.phase === "MOVEMENT" ? (
                      <span className="text-slate-500">{a.unitName} — mouvement soumis</span>
                    ) : (
                      <span>
                        {a.unitName} → {a.targetName} ({formatWeapon(a.weaponType)}) : {a.narrative ?? "en attente…"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-400">Intervenir sur une unité</h2>
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label>
                Unité
                <select
                  value={adjustUnitId}
                  onChange={(e) => setAdjustUnitId(e.target.value)}
                  className="mt-1 block rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
                >
                  {props.participants.map((p) => (
                    <option key={p.unitId} value={p.unitId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Variation de potentiel
                <input
                  type="number"
                  step="0.5"
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(Number(e.target.value))}
                  className="mt-1 block w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
                  placeholder="-5 ou +3"
                />
              </label>
              <label className="flex-1">
                Description de l&apos;événement
                <input
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="ex : l'incendie gagne la soute arrière"
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
                />
              </label>
              <button onClick={applyAdjust} disabled={isPending} className="rounded-md bg-brass-700 px-3 py-1.5 font-medium hover:bg-brass-600">
                Appliquer
              </button>
            </div>
          </div>
        </div>

        <aside>
          <h2 className="mb-2 text-sm font-semibold text-slate-400">Messages</h2>
          <div className="mb-2 max-h-[50vh] space-y-1 overflow-y-auto text-xs">
            {props.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded px-2 py-1 ${m.kind === "ARBITER_EVENT" ? "bg-orange-950/40 text-orange-200" : "bg-slate-800 text-slate-300"}`}
              >
                <span className="font-medium">{m.authorName}</span> (T{m.roundNumber}) : {m.body}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <textarea
              value={eventBody}
              onChange={(e) => setEventBody(e.target.value)}
              rows={2}
              placeholder="Événement ou message aux joueurs…"
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
            />
            <button onClick={sendEvent} disabled={isPending} className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">
              Envoyer
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatDepth(band: string) {
  switch (band) {
    case "SHALLOW":
      return "immersion faible";
    case "MEDIUM":
      return "immersion moyenne";
    case "DEEP":
      return "grande immersion";
    default:
      return band;
  }
}

function formatWeapon(w: string | null) {
  switch (w) {
    case "GUN":
      return "canon";
    case "TORPEDO":
      return "torpille";
    case "DEPTH_CHARGE":
      return "grenades ASM";
    default:
      return w ?? "?";
  }
}

function formatEndReason(reason: string | null) {
  switch (reason) {
    case "ALL_ENEMIES_SUNK":
      return "un camp anéanti";
    case "CONTACT_LOST":
      return "contact rompu";
    case "OUT_OF_AMMUNITION":
      return "munitions épuisées";
    case "ARBITER_ENDED":
      return "clos par l'arbitre";
    case "DISENGAGED":
      return "rupture volontaire";
    default:
      return reason ?? "";
  }
}
