import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { registerPwa } from "./pwa";
createRoot(document.getElementById("root")!).render(<App />);
registerPwa();
