import { useQuery } from "@tanstack/react-query";

export function useWorkspaceQueries({
  selectedProjectId,
  selectedArtifactPath,
}: {
  selectedProjectId: string | null;
  selectedArtifactPath: string | null;
}) {
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () => window.desktop.workspace.current(),
  });
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => window.desktop.workspace.list(),
  });
  const personaRag = useQuery({
    queryKey: ["persona-rag", workspace.data],
    queryFn: () => window.desktop.personaRag.status(),
    enabled: Boolean(workspace.data),
    retry: false,
    refetchInterval: 1_000,
  });
  const agentStatus = useQuery({
    queryKey: ["agent-status"],
    queryFn: () => window.desktop.chat.status(),
    enabled: Boolean(workspace.data),
    retry: false,
    refetchInterval: 10_000,
  });
  const projects = useQuery({
    queryKey: ["projects", workspace.data],
    queryFn: () => window.desktop.tasks.list(),
    enabled: Boolean(workspace.data),
  });
  const artifacts = useQuery({
    queryKey: ["artifacts", selectedProjectId],
    queryFn: () => {
      if (!selectedProjectId) throw new Error("未选择任务");
      return window.desktop.files.listOutputs(selectedProjectId);
    },
    enabled: Boolean(selectedProjectId),
    refetchInterval: 2_000,
  });
  const preview = useQuery({
    queryKey: ["preview", selectedProjectId, selectedArtifactPath],
    queryFn: () => {
      if (!selectedProjectId) throw new Error("未选择任务");
      if (!selectedArtifactPath) throw new Error("未选择生成物");
      return window.desktop.files.preview(selectedProjectId, selectedArtifactPath);
    },
    enabled: Boolean(selectedProjectId && selectedArtifactPath),
  });

  return { workspace, workspaces, personaRag, agentStatus, projects, artifacts, preview };
}
