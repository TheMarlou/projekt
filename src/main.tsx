import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import { installerJournal } from "./lib/journal";

// Avant tout le reste : les erreurs du démarrage comptent aussi pour « Signaler un problème ».
installerJournal();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
