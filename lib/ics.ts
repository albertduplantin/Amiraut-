export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
};

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcsText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildIcsCalendar(name: string, events: IcsEvent[]) {
  const now = formatIcsDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Les Semaines de l'Hexagone//FR",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatIcsDate(event.start)}`,
      `DTEND:${formatIcsDate(event.end)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`
    );
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
