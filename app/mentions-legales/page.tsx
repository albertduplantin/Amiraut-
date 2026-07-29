export const metadata = { title: "Mentions légales — Les Semaines de l'Hexagone" };

export default function MentionsLegalesPage() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>Mentions légales</h1>

      <section className="section">
        <h2>Éditeur du site</h2>
        <p className="prose">
          Ce site est édité par l&apos;association CERCLE DE STRATEGIE, association loi
          1901 fondée en 1987.
          <br />
          Siège social : Centre Les Roises, 14 rue de la Gare, 55200 Commercy, France.
          <br />
          SIREN : 348 372 590.
          <br />
          Directeur de la publication : [à compléter — nom du président ou représentant
          légal actuel de l&apos;association].
          <br />
          Contact : [à compléter — adresse email de contact de l&apos;association].
        </p>
      </section>

      <section className="section">
        <h2>Hébergement</h2>
        <p className="prose">
          Ce site est hébergé par Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789,
          États-Unis (vercel.com). La base de données est hébergée par Neon
          (neon.tech).
        </p>
      </section>

      <section className="section">
        <h2>Propriété intellectuelle</h2>
        <p className="prose">
          L&apos;ensemble des contenus de ce site (textes, programme, visuels) est la
          propriété du CERCLE DE STRATEGIE, sauf mention contraire.
        </p>
      </section>

      <section className="section">
        <h2>Contact</h2>
        <p className="prose">
          Pour toute question relative au site ou à tes données personnelles, contacte
          l&apos;association via [à compléter].
        </p>
      </section>
    </div>
  );
}
