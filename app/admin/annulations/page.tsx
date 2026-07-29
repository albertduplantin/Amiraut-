import Link from "next/link";
import { getActiveSejour } from "@/lib/sejour";
import { prisma } from "@/lib/prisma";

const formatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AdminAnnulationsPage() {
  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <p className="section muted">
        Configure d&apos;abord le <Link href="/admin/sejour">séjour</Link>.
      </p>
    );
  }

  const evenements = await prisma.evenement.findMany({
    where: { sejourId: sejour.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="section">
      <p className="muted">
        Désistements et désinscriptions de jeux, dans l&apos;ordre chronologique inverse.
      </p>
      {evenements.length === 0 ? (
        <p className="muted section">Aucun désistement pour l&apos;instant.</p>
      ) : (
        <div className="card-list section">
          {evenements.map((e) => (
            <div className="card" key={e.id}>
              <p>{e.message}</p>
              <p className="muted">{formatter.format(e.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
