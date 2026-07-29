import { getActiveSejour } from "@/lib/sejour";
import { dateKey } from "@/lib/format";
import { SejourForm } from "./sejour-form";

export default async function AdminSejourPage() {
  const sejour = await getActiveSejour();

  return (
    <div className="section">
      <SejourForm
        sejour={
          sejour
            ? {
                id: sejour.id,
                nom: sejour.nom,
                description: sejour.description,
                dateDebut: dateKey(sejour.dateDebut),
                dateFin: dateKey(sejour.dateFin),
                prixNuit: (sejour.prixNuitCts / 100).toString(),
                prixRepas: (sejour.prixRepasCts / 100).toString(),
                infosPratiques: sejour.infosPratiques ?? "",
              }
            : null
        }
      />
    </div>
  );
}
