export const metadata = { title: "Confidentialité — Les Semaines de l'Hexagone" };

export default function ConfidentialitePage() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>Politique de confidentialité</h1>
      <p className="muted">
        Le CERCLE DE STRATEGIE (association loi 1901) est responsable du traitement des
        données personnelles collectées sur ce site.
      </p>

      <section className="section">
        <h2>Données collectées</h2>
        <p className="prose">
          Lors de la création d&apos;un compte et de l&apos;inscription à un séjour, nous
          collectons : prénom, nom, email, mot de passe (stocké de façon chiffrée,
          jamais en clair), et, si tu choisis de les renseigner, ton régime
          alimentaire/allergies, un contact d&apos;urgence, une préférence de
          colocataire, et les jeux/nuits/repas auxquels tu t&apos;inscris.
        </p>
      </section>

      <section className="section">
        <h2>Pourquoi ces données ?</h2>
        <p className="prose">
          Ces informations servent uniquement à l&apos;organisation du séjour :
          identification, facturation des nuitées/repas, gestion des places aux jeux,
          adaptation des repas aux allergies, et contact en cas d&apos;urgence pendant le
          séjour. Elles ne sont jamais vendues ni transmises à des tiers en dehors des
          prestataires techniques nécessaires au fonctionnement du site (hébergement,
          base de données, envoi d&apos;email).
        </p>
      </section>

      <section className="section">
        <h2>Durée de conservation</h2>
        <p className="prose">
          Tes données sont conservées tant que ton compte existe. Tu peux les supprimer
          à tout moment depuis ton espace personnel (section « Mon compte »), ce qui
          efface définitivement ton compte et toutes tes réservations.
        </p>
      </section>

      <section className="section">
        <h2>Tes droits</h2>
        <p className="prose">
          Conformément au RGPD, tu disposes d&apos;un droit d&apos;accès, de
          rectification et de suppression de tes données. Tu peux exercer ces droits
          directement depuis ton espace personnel, ou en contactant l&apos;association
          (voir les{" "}
          <a href="/mentions-legales">mentions légales</a>).
        </p>
      </section>

      <section className="section">
        <h2>Sécurité</h2>
        <p className="prose">
          Les mots de passe sont chiffrés (hachage bcrypt), les connexions au site sont
          sécurisées (HTTPS) et l&apos;accès aux comptes est protégé contre les
          tentatives de connexion abusives.
        </p>
      </section>
    </div>
  );
}
