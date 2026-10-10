import { createRoot } from "react-dom/client";
import { ComponentGallery } from "./components/component-gallery";
import "./theme.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<ComponentGallery />);
