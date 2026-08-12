"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { sendSignalAction } from "./actions";

type Channel = "VISUAL" | "TBS" | "HF_LONG" | "HF_KURZSIGNAL";
type KurzsignalType = "CONTACT" | "POSITION" | "WEATHER";

type UnitDto = { id: string; name: string; className: string };
type SignalDto = {
  id: string;
  turnNumber: number;
  senderName: string;
  channel: Channel;
  kurzsignalType: string | null;
  body: string;
  intercepted: boolean;
  createdAt: string;
};

const CHANNEL_INFO: Record<
  Channel,
  { label: string; risk: "none" | "low" | "high"; riskLabel: string; description: string }
> = {
  VISUAL: {
    label: "Visuel (lampe Aldis, pavillons)",
    risk: "none",
    riskLabel: "Aucune émission radio — indétectable",
    description: "Vue directe seulement, quelques nm. Inutilisable de nuit ou par mauvaise visibilité.",
  },
  TBS: {
    label: "TBS / VHF voix (Talk Between Ships)",
    risk: "none",
    riskLabel: "Quasi indétectable au-delà de l'horizon",
    description: "~25 nm, portée optique. Radio tactique interne à une escadre.",
  },
  HF_LONG: {
    label: "HF / W-T — message long (Morse)",
    risk: "high",
    riskLabel: "Forte exposition à la goniométrie",
    description: "Portée illimitée, mais temps d'antenne long : le risque d'être relevé par un HF/DF adverse est maximal.",
  },
  HF_KURZSIGNAL: {
    label: "HF / W-T — Kurzsignal (code comprimé)",
    risk: "low",
    riskLabel: "Exposition réduite (~20s d'antenne)",
    description: "Portée illimitée, conçu pour passer sous le temps nécessaire à un relèvement précis. Formes standard uniquement.",
  },
};

const KURZSIGNAL_LABELS: Record<KurzsignalType, string> = {
  CONTACT: "Rapport de contact",
  POSITION: "Rapport de position",
  WEATHER: "Rapport météo",
};

const RISK_STYLES: Record<"none" | "low" | "high", string> = {
  none: "border-emerald-800 bg-emerald-950/30 text-emerald-300",
  low: "border-amber-800 bg-amber-950/30 text-amber-300",
  high: "border-red-800 bg-red-950/30 text-red-300",
};

export function CommsClient(props: { turn: { id: string; number: number } | null; units: UnitDto[]; signals: SignalDto[] }) {
  const { turn, units, signals } = props;

  const [senderUnitId, setSenderUnitId] = useState(units[0]?.id ?? "");
  const [channel, setChannel] = useState<Channel>("TBS");
  const [kurzsignalType, setKurzsignalType] = useState<KurzsignalType>("CONTACT");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const maxLength = channel === "HF_KURZSIGNAL" ? 80 : 500;
  const info = CHANNEL_INFO[channel];

  const groupedByTurn = useMemo(() => {
    const map = new Map<number, SignalDto[]>();
    for (const s of signals) {
      const list = map.get(s.turnNumber) ?? [];
      list.push(s);
      map.set(s.turnNumber, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [signals]);

  function send() {
    if (!turn || !senderUnitId || body.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await sendSignalAction({
        turnId: turn.id,
        senderUnitId,
        channel,
        body,
        kurzsignalType: channel === "HF_KURZSIGNAL" ? kurzsignalType : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
    });
  }

  return (
    <div className="chart-room-bg min-h-screen text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-2xl text-brass-300">Communications</h1>
          <Link href="/team/orders" className="rounded-md border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-900">
            ← Ordres
          </Link>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Choisissez ce que vous dites et par quel canal. Se taire n&apos;a aucun risque mais aveugle votre camp ;
          parler en HF porte loin mais peut vous faire repérer par goniométrie.
        </p>

        {turn ? (
          <div className="mt-6 space-y-4 rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold text-slate-300">Envoyer un message — Tour {turn.number}</h2>

            <label className="block text-sm">
              Unité émettrice
              <select
                value={senderUnitId}
                onChange={(e) => setSenderUnitId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.className}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(CHANNEL_INFO) as Channel[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setChannel(c)}
                  className={`rounded-md border p-2 text-left text-xs transition ${
                    channel === c ? "border-brass-500 bg-brass-900/20" : "border-slate-800 hover:bg-slate-850"
                  }`}
                >
                  <div className="font-medium text-slate-200">{CHANNEL_INFO[c].label}</div>
                  <div className="mt-0.5 text-slate-500">{CHANNEL_INFO[c].description}</div>
                </button>
              ))}
            </div>

            <div className={`rounded-md border px-3 py-2 text-xs ${RISK_STYLES[info.risk]}`}>{info.riskLabel}</div>

            {channel === "HF_KURZSIGNAL" && (
              <label className="block text-sm">
                Forme du message
                <select
                  value={kurzsignalType}
                  onChange={(e) => setKurzsignalType(e.target.value as KurzsignalType)}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                >
                  {(Object.keys(KURZSIGNAL_LABELS) as KurzsignalType[]).map((t) => (
                    <option key={t} value={t}>
                      {KURZSIGNAL_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm">
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, maxLength))}
                rows={channel === "HF_KURZSIGNAL" ? 2 : 4}
                placeholder={
                  channel === "HF_KURZSIGNAL"
                    ? "ex : contact cuirassé, cap 220, 63°25N 31°40O"
                    : "Rédigez votre message…"
                }
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
              />
              <span className="mt-0.5 block text-right text-[11px] text-slate-600">
                {body.length} / {maxLength}
              </span>
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={send}
              disabled={isPending || !senderUnitId || body.trim().length === 0}
              className="rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500 disabled:opacity-50"
            >
              {isPending ? "Envoi…" : "Envoyer"}
            </button>
          </div>
        ) : (
          <p className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            Aucun tour ouvert pour l&apos;instant — l&apos;arbitre n&apos;a pas encore défini la météo de ce tour.
          </p>
        )}

        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-slate-400">Trafic envoyé par votre camp</h2>
          {groupedByTurn.length === 0 ? (
            <p className="text-sm text-slate-600">Aucun message envoyé pour l&apos;instant.</p>
          ) : (
            <div className="space-y-4">
              {groupedByTurn.map(([turnNumber, list]) => (
                <div key={turnNumber}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tour {turnNumber}</h3>
                  <ul className="space-y-1.5">
                    {list.map((s) => (
                      <li key={s.id} className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-500">
                            {s.senderName} · {CHANNEL_INFO[s.channel].label}
                            {s.kurzsignalType && ` · ${KURZSIGNAL_LABELS[s.kurzsignalType as KurzsignalType]}`}
                          </span>
                          {s.intercepted && (
                            <span
                              className="rounded border border-red-800 bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300"
                              title="Une unité adverse équipée de goniométrie HF a obtenu un relèvement sur cette émission."
                            >
                              🎯 intercepté
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-slate-200">{s.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
