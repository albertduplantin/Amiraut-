import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buildGameEndReport, unitStatusLabel } from "@/lib/gameEnd";
import { PrintButton } from "./PrintButton";

const CATEGORY_LABEL: Record<string, string> = {
  SURFACE_SHIP: "Navire de surface",
  SUBMARINE: "Sous-marin",
  AIRCRAFT: "Aéronef",
};

function formatArchivalDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

export default async function GameEndReportPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: session.scenarioId }, select: { status: true } });
  if (scenario.status !== "COMPLETED") {
    redirect(session.role === "ARBITER" ? "/arbiter" : "/team/orders");
  }

  const report = await buildGameEndReport(session.scenarioId);
  const refCode = session.scenarioId.slice(-8).toUpperCase();

  return (
    <div className="chart-room-bg min-h-screen px-4 py-10 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between print:hidden">
        <p className="text-xs text-slate-500">Ce document est visible par tous les participants — la partie est terminée.</p>
        <PrintButton />
      </div>

      <article className="dossier-paper relative mx-auto max-w-3xl rounded-sm p-8 sm:p-12 print:shadow-none">
        <div className="dossier-stamp absolute right-6 top-6 select-none rounded px-3 py-1 text-xs font-bold uppercase tracking-widest sm:right-10 sm:top-10">
          Confidentiel
        </div>

        <header className="mb-8 border-b-4 border-double border-[#5a4520] pb-4">
          <p className="text-xs uppercase tracking-[0.3em] text-[#6b5628]">Amirauté — État-major</p>
          <h1 className="font-display mt-2 max-w-[80%] text-2xl uppercase leading-tight tracking-wide sm:text-3xl">
            Compte rendu de fin d&apos;opération
          </h1>
          <p className="mt-3 text-xs uppercase tracking-wider text-[#6b5628]">
            Réf. n° {refCode} — Diffusion restreinte aux belligérants
          </p>
        </header>

        <section className="mb-8">
          <h2 className="font-display text-lg uppercase tracking-wide">{report.scenarioName}</h2>
          {report.description && <p className="mt-2 italic leading-relaxed text-[#3a2e18]">« {report.description} »</p>}
        </section>

        <Section title="I. Déroulement">
          <p>
            {report.turnsPlayed === 0
              ? "L'opération a été close par l'arbitre avant la publication d'un premier tour"
              : `L'opération a duré ${report.turnsPlayed} tour${report.turnsPlayed > 1 ? "s" : ""} de jeu`}
            {report.engagementsCount > 0 && (
              <>
                {" "}
                et donné lieu à {report.engagementsCount} engagement{report.engagementsCount > 1 ? "s" : ""} rapproché
                {report.engagementsCount > 1 ? "s" : ""}
              </>
            )}
            .
          </p>
        </Section>

        <Section title="II. Pertes et disponibilités">
          <div className="space-y-6">
            {report.teams.map((team) => (
              <div key={team.teamName}>
                <h3 className="font-display flex items-center gap-2 text-sm uppercase tracking-wide">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.colorHex }} />
                  {team.teamName}
                </h3>
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-[#8a7038] text-xs uppercase tracking-wide text-[#6b5628]">
                      <th className="py-1 pr-2 text-left font-normal">Bâtiment</th>
                      <th className="py-1 pr-2 text-left font-normal">Type</th>
                      <th className="py-1 text-right font-normal">Devenir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.units.map((u) => (
                      <tr key={u.id} className="border-b border-[#c9b98a]/60">
                        <td className="py-1 pr-2 align-top">{u.name}</td>
                        <td className="py-1 pr-2 align-top text-[#5a4a2a]">
                          {CATEGORY_LABEL[u.category] ?? u.category} — {u.className}
                        </td>
                        <td className={`py-1 text-right align-top ${u.status === "SUNK" ? "font-semibold" : ""}`}>{unitStatusLabel(u.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-xs uppercase tracking-wide text-[#6b5628]">
                  {team.sunkCount} perdu{team.sunkCount !== 1 ? "s" : ""} · {team.damagedCount} endommagé{team.damagedCount !== 1 ? "s" : ""} ·{" "}
                  {team.activeCount} indemne{team.activeCount !== 1 ? "s" : ""}
                  {team.withdrawnCount > 0 && <> · {team.withdrawnCount} retiré{team.withdrawnCount !== 1 ? "s" : ""}</>}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {report.teams.length === 2 && (
          <Section title="III. Bilan">
            <p>
              Le camp « {report.teams[0].teamName} » a coulé {report.teams[1].sunkCount} unité
              {report.teams[1].sunkCount !== 1 ? "s" : ""} adverse{report.teams[1].sunkCount !== 1 ? "s" : ""} pour la perte de{" "}
              {report.teams[0].sunkCount} des siennes.
            </p>
            <p>
              Le camp « {report.teams[1].teamName} » a coulé {report.teams[0].sunkCount} unité
              {report.teams[0].sunkCount !== 1 ? "s" : ""} adverse{report.teams[0].sunkCount !== 1 ? "s" : ""} pour la perte de{" "}
              {report.teams[1].sunkCount} des siennes.
            </p>
          </Section>
        )}

        <Section title={`${report.teams.length === 2 ? "IV" : "III"}. Chronologie des faits d'armes`}>
          {report.timeline.length === 0 ? (
            <p className="text-[#5a4a2a]">Aucun coup au but n&apos;a été porté au cours de cette opération.</p>
          ) : (
            <ol className="space-y-2">
              {report.timeline.map((e, i) => (
                <li key={i} className="border-l-2 border-[#8a7038] pl-3">
                  <span className="text-xs uppercase tracking-wide text-[#6b5628]">Tour {e.turnNumber}</span>
                  {e.fatal && <span className="ml-2 text-xs font-bold uppercase tracking-wide text-[#8a1c14]">— perte confirmée</span>}
                  <p className="leading-relaxed">
                    <span className="font-semibold">{e.attackerName}</span> ({e.attackerTeam}) contre{" "}
                    <span className="font-semibold">{e.targetName}</span> ({e.targetTeam}), {e.weaponType}. {e.narrative}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <footer className="mt-10 border-t border-[#8a7038] pt-4 text-sm">
          <p>Vu et transmis,</p>
          <p className="font-display mt-6 tracking-wide">L&apos;Arbitre</p>
          <p className="mt-6 text-xs uppercase tracking-wider text-[#6b5628]">
            Rapport clos et archivé le {formatArchivalDate(report.endedAt)}
          </p>
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display mb-2 text-sm uppercase tracking-wide">{title}</h2>
      <div className="space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}
