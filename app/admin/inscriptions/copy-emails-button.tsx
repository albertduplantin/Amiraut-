"use client";

import { useState } from "react";

export function CopyEmailsButton({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(emails.join(", "));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button className="btn btn-sm" type="button" onClick={copy}>
      {copied ? "Copié !" : "Copier les emails des inscrits"}
    </button>
  );
}
