import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const CATEGORY_LABEL: Record<string, string> = {
  SURFACE_SHIP: "Navires de surface",
  SUBMARINE: "Sous-marins",
  AIRCRAFT: "Avions",
};

/**
 * Bibliothèque partagée de classes (navires + avions), éditable par
 * l'arbitre — un scénario peut ensuite y référencer une classe par sa clé
 * plutôt que de la redéfinir en ligne (voir prisma/scenarios/index.ts,
 * résolution des { key, libraryKey }).
 */
export default async function LibraryPage() {
  const session = await getSession();
  if (!session || session.role !== "ARBITER") {
    redirect("/");
  }

  const classes = await prisma.libraryUnitClass.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  const byCategory = new Map<string, typeof classes>();
  for (const c of classes) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c);
    byCategory.set(c.category, list);
  }

  return (
    <div className="chart-room-bg min-h-screen text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl text-brass-300">Bibliothèque de classes</h1>
            <p className="mt-1 text-sm text-slate-400">
              Navires et avions réutilisables d&apos;un scénario à l&apos;autre — référencez-les par leur clé plutôt que de les
              redéfinir.
            </p>
          </div>
          <Link href="/library/new" className="rounded-md bg-brass-600 px-4 py-2 text-sm font-medium hover:bg-brass-500">
            + Ajouter
          </Link>
        </div>

        {classes.length === 0 && <p className="mt-8 text-sm text-slate-500">Aucune classe dans la bibliothèque pour l&apos;instant.</p>}

        <div className="mt-8 space-y-6">
          {(["SURFACE_SHIP", "SUBMARINE", "AIRCRAFT"] as const).map((cat) => {
            const list = byCategory.get(cat);
            if (!list || list.length === 0) return null;
            return (
              <div key={cat}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{CATEGORY_LABEL[cat]}</h2>
                <ul className="space-y-1.5">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/library/${c.id}/edit`}
                        className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm hover:bg-slate-850"
                      >
                        <span>
                          <span className="font-medium">{c.name}</span> <span className="text-slate-500">— {c.nation}</span>
                        </span>
                        <code className="text-xs text-slate-600">{c.key}</code>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
