"use client";

import { useActionState, useMemo, useState } from "react";
import { saveReservationsAction } from "@/lib/actions/inscription";
import { centsToEuros } from "@/lib/format";

type DayRow = {
  key: string;
  dayLabel: string;
  nightLabel: string | null;
};

export function InscriptionForm({
  sejourId,
  prixNuitCts,
  prixRepasCts,
  days,
  initialNuits,
  initialRepasDej,
  initialRepasDin,
}: {
  sejourId: string;
  prixNuitCts: number;
  prixRepasCts: number;
  days: DayRow[];
  initialNuits: string[];
  initialRepasDej: string[];
  initialRepasDin: string[];
}) {
  const [state, formAction, pending] = useActionState(saveReservationsAction, undefined);
  const [nuits, setNuits] = useState(new Set(initialNuits));
  const [repasDej, setRepasDej] = useState(new Set(initialRepasDej));
  const [repasDin, setRepasDin] = useState(new Set(initialRepasDin));

  const total = useMemo(() => {
    return nuits.size * prixNuitCts + (repasDej.size + repasDin.size) * prixRepasCts;
  }, [nuits, repasDej, repasDin, prixNuitCts, prixRepasCts]);

  function toggle(setFn: typeof setNuits, key: string) {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="sejourId" value={sejourId} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Jour</th>
              <th>Nuit sur place</th>
              <th>Déjeuner</th>
              <th>Dîner</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.key}>
                <td style={{ textTransform: "capitalize" }}>{day.dayLabel}</td>
                <td>
                  {day.nightLabel ? (
                    <label className="checkbox-row" title={day.nightLabel}>
                      <input
                        type="checkbox"
                        name={`nuit_${day.key}`}
                        checked={nuits.has(day.key)}
                        onChange={() => toggle(setNuits, day.key)}
                      />
                    </label>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      name={`repas_dejeuner_${day.key}`}
                      checked={repasDej.has(day.key)}
                      onChange={() => toggle(setRepasDej, day.key)}
                    />
                  </label>
                </td>
                <td>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      name={`repas_diner_${day.key}`}
                      checked={repasDin.has(day.key)}
                      onChange={() => toggle(setRepasDin, day.key)}
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">Le petit-déjeuner est compris dans le prix de la nuitée.</p>

      <div className="stats-row">
        <div className="stat">
          <div className="muted">Nuitées sélectionnées</div>
          <div className="value">{nuits.size}</div>
        </div>
        <div className="stat">
          <div className="muted">Repas sélectionnés</div>
          <div className="value">{repasDej.size + repasDin.size}</div>
        </div>
        <div className="stat">
          <div className="muted">Total estimé</div>
          <div className="value">{centsToEuros(total)}</div>
        </div>
      </div>

      <div role="status" aria-live="polite">
        {state?.error && <p className="error-text">{state.error}</p>}
        {!state?.error && state?.success && (
          <p className="success-text">Enregistré !</p>
        )}
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Enregistrement..." : "Enregistrer mon hébergement / repas"}
      </button>
    </form>
  );
}
