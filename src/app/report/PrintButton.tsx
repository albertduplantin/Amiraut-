"use client";

/** Imprime/exporte le compte rendu en PDF via la boîte de dialogue du navigateur — la mise en page (print:*) masque le reste de l'interface. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-900"
    >
      🖨 Imprimer / exporter en PDF
    </button>
  );
}
