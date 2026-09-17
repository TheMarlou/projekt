import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { installerJournal } from "./lib/journal";
import { installerMesureErreurs } from "./lib/statistiques";

// Avant tout le reste : les erreurs du démarrage comptent aussi pour « Signaler un problème ».
installerJournal();
// Statistiques anonymes des erreurs : n'envoie rien si la personne ne les a pas activées.
installerMesureErreurs();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
