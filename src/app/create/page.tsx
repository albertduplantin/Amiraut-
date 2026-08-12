import { prisma } from "@/lib/prisma";
import { listAllScenarioSummaries } from "../../../prisma/scenarios/index";
import { CreateGameForm } from "./CreateGameForm";

export default async function CreatePage() {
  const scenarios = await listAllScenarioSummaries(prisma);
  return <CreateGameForm scenarios={scenarios} />;
}
