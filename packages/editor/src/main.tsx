import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { EffectToolConsole } from "./EffectToolConsole.js";
import { EditorStore } from "./store.js";
import "./styles.css";

const store = new EditorStore(window.localStorage);
const root = document.getElementById("root");
if (!root) throw new Error("Editor root element is missing.");

createRoot(root).render(window.location.pathname === "/effect-tool"
  ? <EffectToolConsole />
  : <StrictMode><App store={store} /></StrictMode>);
