import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoAdvanceScenario } from "@/lib/turnEngine";

/**
 * Cible du cron Vercel (voir vercel.json, une fois par jour sur le plan
 * Hobby — c'est cette cadence qui régule le rythme des ordres permanents
 * "route"/rotation, voir autoAdvanceScenario dans turnEngine.ts). Protégé
 * par CRON_SECRET (motif standard Vercel Cron) : Vercel ajoute
 * automatiquement l'en-tête Authorization sur les invocations programmées,
 * mais rien n'empêche un appel externe direct sans ce secret.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const scenarios = await prisma.scenario.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } });

  const results: { scenarioId: string; name: string; turnsAdvanced: number; stoppedReason: string }[] = [];
  for (const scenario of scenarios) {
    try {
      const { turnsAdvanced, stoppedReason } = await autoAdvanceScenario(scenario.id);
      results.push({ scenarioId: scenario.id, name: scenario.name, turnsAdvanced, stoppedReason });
    } catch (error) {
      results.push({
        scenarioId: scenario.id,
        name: scenario.name,
        turnsAdvanced: 0,
        stoppedReason: `erreur : ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return NextResponse.json({ ok: true, checkedAt: new Date().toISOString(), scenarios: results });
}
