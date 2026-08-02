"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-100">
      <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
      <p className="max-w-md text-slate-400">
        Quelque chose s&apos;est mal passé côté serveur. Réessaie — si le problème persiste, note ce qui s&apos;est
        passé juste avant (quel écran, quelle action).
      </p>
      {error.digest && <p className="text-xs text-slate-600">Référence : {error.digest}</p>}
      <button onClick={() => reset()} className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500">
        Réessayer
      </button>
    </div>
  );
}
