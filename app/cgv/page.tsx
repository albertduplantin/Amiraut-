export const metadata = { title: "Conditions générales — Les Semaines de l'Hexagone" };

export default function CGVPage() {
  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1>Conditions générales</h1>
      <p className="muted">
        Applicables aux inscriptions aux séjours organisés par le CERCLE DE STRATEGIE
        via ce site.
      </p>

      <section className="section">
        <h2>Inscription</h2>
        <p className="prose">
          L&apos;inscription à un séjour se fait en créant un compte et en sélectionnant
          les nuits, repas et jeux souhaités. Le montant affiché sur le site est une
          estimation basée sur les tarifs en vigueur ; il ne constitue pas à ce jour un
          paiement en ligne. Les modalités de règlement (virement, chèque, espèces...)
          sont communiquées séparément par l&apos;organisateur.
        </p>
      </section>

      <section className="section">
        <h2>Modification et annulation</h2>
        <p className="prose">
          Tu peux modifier ou annuler tes réservations de nuits, repas et jeux à tout
          moment depuis ton espace personnel, tant que le séjour n&apos;a pas commencé.
          En cas d&apos;annulation totale de ta participation après un éventuel
          règlement, contacte l&apos;organisateur pour connaître les modalités de
          remboursement.
        </p>
      </section>

      <section className="section">
        <h2>Absence de droit de rétractation</h2>
        <p className="prose">
          Conformément à l&apos;article L221-28 12° du Code de la consommation, le droit
          de rétractation de 14 jours ne s&apos;applique pas aux prestations de loisirs
          fournies à une date ou selon une périodicité déterminée (ce qui est le cas des
          séjours proposés ici). Une fois ton inscription confirmée, celle-ci est donc
          considérée comme ferme, sous réserve des conditions d&apos;annulation
          ci-dessus.
        </p>
      </section>

      <section className="section">
        <h2>Annulation du séjour par l&apos;organisateur</h2>
        <p className="prose">
          Si l&apos;association devait annuler un séjour (cas de force majeure,
          nombre de participants insuffisant...), les participants seraient informés
          dans les meilleurs délais et intégralement remboursés des sommes déjà
          versées.
        </p>
      </section>

      <section className="section">
        <h2>Places limitées</h2>
        <p className="prose">
          Les jeux proposés ont un nombre de places limité. En cas de complet, une liste
          d&apos;attente permet d&apos;être automatiquement inscrit·e si une place se
          libère.
        </p>
      </section>

      <section className="section">
        <h2>Contact</h2>
        <p className="prose">
          Pour toute question, voir les{" "}
          <a href="/mentions-legales">mentions légales</a>.
        </p>
      </section>
    </div>
  );
}
