// src/main.tsx — starts the clock loop and renders the app. M1 adds URL state and cameras.json.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { startClockLoop } from "./state/clockLoop";
import { store } from "./state/store";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("index.html has no #root element");

// Module scope, never inside an effect: StrictMode runs effects twice in development.
startClockLoop(store);

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
