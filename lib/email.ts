import "server-only";
import { Resend } from "resend";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

let client: Resend | null = null;

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  const resend = getClient();
  if (!resend) {
    // Service d'email non configuré : on n'échoue pas silencieusement l'action
    // appelante, on ignore simplement l'envoi.
    return;
  }

  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  } catch (error) {
    console.error("Échec d'envoi d'email", error);
  }
}

function wrapper(title: string, bodyHtml: string) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2a24;">
      <h2 style="color: #1d4645;">${title}</h2>
      ${bodyHtml}
      <p style="color: #6b7268; font-size: 0.85rem; margin-top: 24px;">
        Les Semaines de l'Hexagone — Cercle de Stratégie
      </p>
    </div>
  `;
}

export function confirmationReservationEmail({
  prenom,
  sejourNom,
  nuits,
  repas,
  totalFormatted,
  lienEspace,
}: {
  prenom: string;
  sejourNom: string;
  nuits: number;
  repas: number;
  totalFormatted: string;
  lienEspace: string;
}) {
  return wrapper(
    "Ton inscription est enregistrée",
    `
      <p>Salut ${prenom},</p>
      <p>Ta réservation pour <strong>${sejourNom}</strong> a bien été enregistrée :</p>
      <ul>
        <li>${nuits} nuitée(s)</li>
        <li>${repas} repas</li>
        <li>Total estimé : <strong>${totalFormatted}</strong></li>
      </ul>
      <p><a href="${lienEspace}">Voir mon espace</a></p>
    `
  );
}

export function promotionListeAttenteEmail({
  prenom,
  jeuNom,
  lienEspace,
}: {
  prenom: string;
  jeuNom: string;
  lienEspace: string;
}) {
  return wrapper(
    "Une place s'est libérée !",
    `
      <p>Salut ${prenom},</p>
      <p>Tu étais en liste d'attente pour <strong>${jeuNom}</strong> : une place vient de se
      libérer et tu es maintenant inscrit·e.</p>
      <p><a href="${lienEspace}">Voir mon planning</a></p>
    `
  );
}

export function reinitialisationMotDePasseEmail({
  prenom,
  lienReinitialisation,
}: {
  prenom: string;
  lienReinitialisation: string;
}) {
  return wrapper(
    "Réinitialise ton mot de passe",
    `
      <p>Salut ${prenom},</p>
      <p>Tu as demandé à réinitialiser ton mot de passe. Ce lien est valable 30 minutes :</p>
      <p><a href="${lienReinitialisation}">Choisir un nouveau mot de passe</a></p>
      <p>Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
    `
  );
}

export function rappelSejourEmail({
  prenom,
  sejourNom,
  dateDebutFormatted,
  lienEspace,
}: {
  prenom: string;
  sejourNom: string;
  dateDebutFormatted: string;
  lienEspace: string;
}) {
  return wrapper(
    "C'est bientôt !",
    `
      <p>Salut ${prenom},</p>
      <p><strong>${sejourNom}</strong> commence le <strong>${dateDebutFormatted}</strong>, dans une semaine !</p>
      <p><a href="${lienEspace}">Voir mon planning</a></p>
    `
  );
}
