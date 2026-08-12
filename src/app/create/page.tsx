import { SCENARIO_LIBRARY } from "../../../prisma/scenarios/index";
import { CreateGameForm } from "./CreateGameForm";

export default function CreatePage() {
  const scenarios = SCENARIO_LIBRARY.map((s) => ({
    key: s.key,
    name: s.name,
    description: s.description,
    dateLabel: s.dateLabel,
    defaultTurnMinutes: s.defaultTurnMinutes,
    teamNames: s.teams.map((t) => t.name),
  }));

  return <CreateGameForm scenarios={scenarios} />;
}
