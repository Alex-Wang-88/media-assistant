import { create } from "zustand";

type UiState = {
  selectedProjectId: string | null;
  selectedArtifactPath: string | null;
  knowledgeEnabled: boolean;
  strategyEnabled: boolean;
  autoExecute: boolean;
  selectProject(id: string): void;
  resetProject(): void;
  selectArtifact(path: string | null): void;
  setToggle(key: "knowledgeEnabled" | "strategyEnabled" | "autoExecute", value: boolean): void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedProjectId: null,
  selectedArtifactPath: null,
  knowledgeEnabled: true,
  strategyEnabled: false,
  autoExecute: false,
  selectProject: (id) => set({ selectedProjectId: id, selectedArtifactPath: null }),
  resetProject: () => set({ selectedProjectId: null, selectedArtifactPath: null }),
  selectArtifact: (path) => set({ selectedArtifactPath: path }),
  setToggle: (key, value) => set({ [key]: value }),
}));
