import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EffectToolConsole } from "./EffectToolConsole.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("AE Agent root element is missing.");

createRoot(root).render(<StrictMode><EffectToolConsole /></StrictMode>);
