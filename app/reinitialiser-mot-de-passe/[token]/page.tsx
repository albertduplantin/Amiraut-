import { ResetForm } from "./reset-form";

export default async function ReinitialiserMotDePassePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="container" style={{ maxWidth: 420 }}>
      <h1>Choisir un nouveau mot de passe</h1>
      <div className="card section">
        <ResetForm token={token} />
      </div>
    </div>
  );
}
