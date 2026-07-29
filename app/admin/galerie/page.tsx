import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getActiveSejour } from "@/lib/sejour";
import { ajouterPhotoAction, supprimerPhotoAction } from "@/lib/actions/admin";

export default async function AdminGaleriePage() {
  const sejour = await getActiveSejour();

  if (!sejour) {
    return (
      <p className="section muted">
        Configure d&apos;abord le <Link href="/admin/sejour">séjour</Link>.
      </p>
    );
  }

  const photos = await prisma.photo.findMany({
    where: { sejourId: sejour.id },
    orderBy: { ordre: "asc" },
  });

  return (
    <div className="section">
      <p className="muted">
        Ajoute des photos par lien (URL) — par exemple depuis un album Google Photos,
        Facebook ou un hébergeur d&apos;images. Pas besoin d&apos;uploader de fichier.
      </p>

      {photos.length > 0 && (
        <div className="card-list section">
          {photos.map((photo) => (
            <div className="card" key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.legende ?? ""}
                style={{ maxWidth: 200, borderRadius: 8, marginBottom: 8 }}
              />
              <p className="muted">{photo.legende || "(sans légende)"}</p>
              <form action={supprimerPhotoAction}>
                <input type="hidden" name="id" value={photo.id} />
                <button className="btn btn-danger btn-sm" type="submit">
                  Supprimer
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      <form action={ajouterPhotoAction} className="card section">
        <input type="hidden" name="sejourId" value={sejour.id} />
        <label>
          URL de l&apos;image
          <input type="url" name="url" required placeholder="https://..." />
        </label>
        <label>
          Légende (optionnel)
          <input type="text" name="legende" />
        </label>
        <button className="btn btn-primary" type="submit">
          Ajouter la photo
        </button>
      </form>
    </div>
  );
}
