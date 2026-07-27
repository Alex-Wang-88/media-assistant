import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import {
  applyAppearance,
  loadAppearance,
  resolveAppearance,
  systemPrefersDark,
} from "./appearance";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1_000, retry: 1 } },
});

const root = document.getElementById("root");
if (!root) throw new Error("Renderer root element is missing");

applyAppearance(document.documentElement, resolveAppearance(loadAppearance(), systemPrefersDark()));

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
