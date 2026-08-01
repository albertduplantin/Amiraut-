export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const error = params.error;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
      <h1 className="text-3xl font-semibold tracking-tight">Amirauté en ligne</h1>
      <p className="mt-3 max-w-md text-slate-400">
        Jeu de guerre naval asynchrone. Utilisez le lien d&apos;invitation qui vous a été transmis par
        l&apos;arbitre pour rejoindre une partie.
      </p>
      {error === "invite-invalide" && (
        <p className="mt-6 rounded-md border border-red-800 bg-red-950 px-4 py-2 text-sm text-red-300">
          Ce lien d&apos;invitation n&apos;est pas valide. Vérifiez l&apos;URL ou contactez l&apos;arbitre de la
          partie.
        </p>
      )}
    </div>
  );
}
