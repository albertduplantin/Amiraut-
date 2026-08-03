import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { setWeatherAction } from "./actions";
import { SubmitButton } from "./SubmitButton";

export default async function ArbiterDashboardPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const [scenario, turn, activeUnitCount] = await Promise.all([
    prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } }),
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId },
      orderBy: { number: "desc" },
      include: { weather: true },
    }),
    prisma.unit.count({ where: { scenarioId: session.scenarioId, status: { in: ["ACTIVE", "DAMAGED"] } } }),
  ]);

  if (!turn) {
    return <div className="p-6 text-slate-100">Aucun tour trouvé pour ce scénario.</div>;
  }

  const [orderCount, lastPublishedTurn] = await Promise.all([
    prisma.unitOrder.count({ where: { turnId: turn.id } }),
    prisma.turn.findFirst({
      where: { scenarioId: session.scenarioId, status: "PUBLISHED" },
      orderBy: { number: "desc" },
    }),
  ]);

  const combatEvents = lastPublishedTurn
    ? await prisma.combatEvent.findMany({
        where: { turnId: lastPublishedTurn.id },
        include: {
          attackerUnit: { select: { name: true, fleet: { select: { team: { select: { name: true } } } } } },
          targetUnit: { select: { name: true, fleet: { select: { team: { select: { name: true } } } } } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <div className="chart-room-bg min-h-screen p-6 text-slate-100">
      <h1 className="font-display text-xl tracking-wide text-brass-300">{scenario.name}</h1>
      <p className="mt-1 text-sm text-slate-400">Tour {turn.number} — statut : {formatStatus(turn.status)}</p>

      <Link
        href="/arbiter/positions"
        className="mt-3 inline-block rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-900"
      >
        Repositionner des unités
      </Link>

      {turn.status === "PENDING_ORDERS" && orderCount === 0 && (
        <section className="panel-brass mt-6 max-w-lg rounded-md bg-slate-900 p-4">
          <h2 className="font-display mb-3 tracking-wide text-brass-300">
            {turn.weatherId ? `Modifier les paramètres du tour ${turn.number}` : `Définir la météo du tour ${turn.number}`}
          </h2>
          {turn.weatherId && (
            <p className="mb-3 text-xs text-slate-500">
              Modifiable tant qu&apos;aucun ordre n&apos;a été soumis pour ce tour (ici pré-rempli avec les valeurs
              actuelles).
            </p>
          )}
          <form action={setWeatherAction} className="space-y-3 text-sm">
            <input type="hidden" name="turnId" value={turn.id} />

            <label className="block">
              Durée de ce tour (heures)
              <input
                name="durationHours"
                type="number"
                min={1}
                step="0.5"
                defaultValue={turn.durationMinutes / 60}
                required
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Modifiable à chaque tour (ex: accélérer pour tester la détection en resserrant les flottes).
              </span>
            </label>

            <label className="block">
              Visibilité (nm)
              <input
                name="visibilityNm"
                type="number"
                step="0.5"
                defaultValue={turn.weather?.visibilityNm ?? 8}
                required
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              />
            </label>

            <label className="block">
              État de mer (0-9)
              <input
                name="seaState"
                type="number"
                min={0}
                max={9}
                defaultValue={turn.weather?.seaState ?? 4}
                required
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              />
            </label>

            <label className="block">
              Luminosité
              <select
                name="daylight"
                defaultValue={turn.weather?.daylight ?? "NIGHT"}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              >
                <option value="DAY">Jour</option>
                <option value="TWILIGHT">Crépuscule</option>
                <option value="NIGHT">Nuit</option>
                <option value="POLAR_NIGHT">Nuit polaire</option>
                <option value="POLAR_DAY">Jour polaire</option>
              </select>
            </label>

            <label className="block">
              Précipitations
              <select
                name="precipitation"
                defaultValue={turn.weather?.precipitation ?? "NONE"}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              >
                <option value="NONE">Aucune</option>
                <option value="RAIN">Pluie</option>
                <option value="SNOW">Neige</option>
                <option value="FOG">Brouillard</option>
              </select>
            </label>

            <label className="block">
              Vent (nds, optionnel)
              <input
                name="windKnots"
                type="number"
                step="1"
                defaultValue={turn.weather?.windKnots ?? undefined}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              />
            </label>

            <label className="block">
              Notes (optionnel)
              <textarea
                name="notes"
                rows={2}
                defaultValue={turn.weather?.notes ?? undefined}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1"
              />
            </label>

            <SubmitButton
              pendingLabel="Enregistrement…"
              idleLabel={turn.weatherId ? "Enregistrer" : "Ouvrir le tour aux ordres"}
            />
          </form>
        </section>
      )}

      {turn.status === "PENDING_ORDERS" && orderCount > 0 && (
        <p className="mt-6 text-slate-300">
          Ordres en cours : {orderCount}/{activeUnitCount} unités actives ont soumis un ordre.
        </p>
      )}

      {(turn.status === "PENDING_ARBITER_REVIEW" || turn.status === "RESOLVING") && (
        <div className="mt-6">
          <p className="mb-3 text-slate-300">
            Tous les ordres sont soumis. Détections calculées, en attente de revue.
          </p>
          <Link href="/arbiter/review" className="rounded-md bg-amber-600 px-4 py-2 font-medium hover:bg-amber-500">
            Revoir les détections et publier le tour
          </Link>
        </div>
      )}

      {combatEvents.length > 0 && lastPublishedTurn && (
        <section className="panel-brass mt-6 max-w-2xl rounded-md bg-slate-900 p-4">
          <h2 className="font-display mb-3 tracking-wide text-brass-300">
            Journal de combat — tour {lastPublishedTurn.number}
          </h2>
          <ul className="space-y-1 text-sm">
            {combatEvents.map((c) => (
              <li key={c.id} className="rounded-md bg-slate-950/60 px-3 py-2">
                <div>
                  <span className="font-medium">{c.attackerUnit.name}</span>{" "}
                  <span className="text-xs text-slate-500">({c.attackerUnit.fleet.team.name})</span> →{" "}
                  <span className="font-medium">{c.targetUnit.name}</span>{" "}
                  <span className="text-xs text-slate-500">({c.targetUnit.fleet.team.name})</span>
                </div>
                <div className="text-xs text-slate-400">
                  {formatWeaponType(c.weaponType)} à {c.rangeNm.toFixed(1)}nm · {c.hitChancePercent.toFixed(0)}% de chances ·{" "}
                  {c.hits > 0 ? `${c.hits} coup${c.hits > 1 ? "s" : ""} au but, ${c.damagePoints.toFixed(1)} pts` : "tir manqué"}
                  {c.targetSunk && <span className="text-red-400"> · coulé</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function formatWeaponType(weaponType: string) {
  switch (weaponType) {
    case "GUN":
      return "artillerie";
    case "TORPEDO":
      return "torpille";
    case "DEPTH_CHARGE":
      return "grenades ASM";
    default:
      return weaponType;
  }
}

function formatStatus(status: string) {
  switch (status) {
    case "PENDING_ORDERS":
      return "en attente d'ordres";
    case "RESOLVING":
      return "résolution en cours";
    case "PENDING_ARBITER_REVIEW":
      return "en attente de revue arbitre";
    case "PUBLISHED":
      return "publié";
    default:
      return status;
  }
}
