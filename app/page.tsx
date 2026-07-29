"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function Home() {
  const [resultat, setResultat] = useState("");

  return (
    <div className={styles.page}>
      <button className={styles.button} onClick={() => setResultat("caca prout")}>
        Appuie ici
      </button>
      <div className={styles.resultat}>{resultat}</div>
    </div>
  );
}
