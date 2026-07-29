export function centsToEuros(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
  });
}

export function nightsBetween(dateDebut: Date, dateFin: Date) {
  const nights: Date[] = [];
  const current = new Date(
    Date.UTC(dateDebut.getUTCFullYear(), dateDebut.getUTCMonth(), dateDebut.getUTCDate())
  );
  const end = new Date(
    Date.UTC(dateFin.getUTCFullYear(), dateFin.getUTCMonth(), dateFin.getUTCDate())
  );
  while (current < end) {
    nights.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return nights;
}

export function daysBetween(dateDebut: Date, dateFin: Date) {
  const days: Date[] = [];
  const current = new Date(
    Date.UTC(dateDebut.getUTCFullYear(), dateDebut.getUTCMonth(), dateDebut.getUTCDate())
  );
  const end = new Date(
    Date.UTC(dateFin.getUTCFullYear(), dateFin.getUTCMonth(), dateFin.getUTCDate())
  );
  while (current <= end) {
    days.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatDateLong(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function formatDateShort(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
