import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { setWeatherAction } from "./actions";

export default async function ArbiterDashboardPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId } });
  const turn = await prisma.turn.findFirst({
    where: { scenarioId: session.scenarioId },
    orderBy: { number: "desc" },
    include: { weather: true },
  });

  if (!turn) {
    return <div className="p-6 text-slate-100">Aucun tour trouvé pour ce scénario.</div>;
  }

  const [activeUnitCount, orderCount] = await Promise.all([
    prisma.unit.count({ where: { scenarioId: session.scenarioId, status: "ACTIVE" } }),
    prisma.unitOrder.count({ where: { turnId: turn.id } }),
  ]);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <h1 className="text-xl font-semibold">{scenario.name}</h1>
      <p className="mt-1 text-sm text-slate-400">Tour {turn.number} — statut : {formatStatus(turn.status)}</p>

      <Link
        href="/arbiter/positions"
        className="mt-3 inline-block rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-900"
      >
        Repositionner des unités
      </Link>

      {turn.status === "PENDING_ORDERS" && !turn.weatherId && (
        <section className="mt-6 max-w-lg rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 font-medium">Définir la météo du tour {turn.number}</h2>
          <form action={setWeatherAction} className="space-y-3 text-sm">
            <input type="hidden" name="turnId" value={turn.id} />

            <label className="block">
              Visibilité (nm)
              <input name="visibilityNm" type="number" step="0.5" defaultValue={8} required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
            </label>

            <label className="block">
              État de mer (0-9)
              <input name="seaState" type="number" min={0} max={9} defaultValue={4} required className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
            </label>

            <label className="block">
              Luminosité
              <select name="daylight" defaultValue="NIGHT" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
                <option value="DAY">Jour</option>
                <option value="TWILIGHT">Crépuscule</option>
                <option value="NIGHT">Nuit</option>
                <option value="POLAR_NIGHT">Nuit polaire</option>
                <option value="POLAR_DAY">Jour polaire</option>
              </select>
            </label>

            <label className="block">
              Précipitations
              <select name="precipitation" defaultValue="NONE" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1">
                <option value="NONE">Aucune</option>
                <option value="RAIN">Pluie</option>
                <option value="SNOW">Neige</option>
                <option value="FOG">Brouillard</option>
              </select>
            </label>

            <label className="block">
              Vent (nds, optionnel)
              <input name="windKnots" type="number" step="1" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
            </label>

            <label className="block">
              Notes (optionnel)
              <textarea name="notes" rows={2} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1" />
            </label>

            <button type="submit" className="rounded-md bg-sky-600 px-4 py-1.5 font-medium hover:bg-sky-500">
              Ouvrir le tour aux ordres
            </button>
          </form>
        </section>
      )}

      {turn.status === "PENDING_ORDERS" && turn.weatherId && (
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
    </div>
  );
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
