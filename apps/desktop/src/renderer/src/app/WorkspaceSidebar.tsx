import type { Project, WorkspaceEntry } from "@yoom/desktop-contracts";
import { Icon } from "../ui/Icon";

export type AgentDisplayState = "checking" | "ready" | "unconfigured" | "unavailable";

export function WorkspaceSidebar({
  inert,
  workspacePath,
  workspaces,
  taskName,
  search,
  projects,
  selectedProjectId,
  pendingDeleteProjectId,
  taskDeletePending,
  taskDeleteError,
  streaming,
  personaPending,
  personaError,
  personaReady,
  personaFileCount,
  agentState,
  agentLabel,
  personaSetupOpen,
  personaReadPending,
  personaDeletePending,
  personaDocumentOpen,
  personaDocumentError,
  onActivateWorkspace,
  onChooseWorkspace,
  onTaskNameChange,
  onCreateTask,
  onSearchChange,
  onSelectProject,
  onRequestDeleteProject,
  onCancelDeleteProject,
  onConfirmDeleteProject,
  onOpenPersona,
  onRequestDeletePersona,
  onOpenPublishCenter,
  onOpenSettings,
}: {
  inert: boolean;
  workspacePath: string;
  workspaces: WorkspaceEntry[];
  taskName: string;
  search: string;
  projects: Project[];
  selectedProjectId: string | null;
  pendingDeleteProjectId: string | null;
  taskDeletePending: boolean;
  taskDeleteError: string | null;
  streaming: boolean;
  personaPending: boolean;
  personaError: boolean;
  personaReady: boolean;
  personaFileCount: number;
  agentState: AgentDisplayState;
  agentLabel: string;
  personaSetupOpen: boolean;
  personaReadPending: boolean;
  personaDeletePending: boolean;
  personaDocumentOpen: boolean;
  personaDocumentError: string | null;
  onActivateWorkspace(path: string): void;
  onChooseWorkspace(): void;
  onTaskNameChange(value: string): void;
  onCreateTask(): void;
  onSearchChange(value: string): void;
  onSelectProject(id: string): void;
  onRequestDeleteProject(id: string): void;
  onCancelDeleteProject(): void;
  onConfirmDeleteProject(id: string): void;
  onOpenPersona(): void;
  onRequestDeletePersona(): void;
  onOpenPublishCenter(): void;
  onOpenSettings(): void;
}) {
  return (
    <aside className="sidebar" aria-hidden={inert} inert={inert ? true : undefined}>
      <div className="logo-row">
        <span className="logo">
          <Icon name="spark" />
        </span>
        <span className="brand-copy">
          <strong>沄荣助手</strong>
          <small>Media workspace</small>
        </span>
      </div>
      <div className="workspace-switcher">
        <select
          aria-label="当前工作区"
          value={workspacePath}
          onChange={(event) => onActivateWorkspace(event.target.value)}
        >
          {workspaces.map((entry) => (
            <option key={entry.path} value={entry.path}>
              {entry.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="添加工作区"
          aria-label="添加工作区"
          onClick={onChooseWorkspace}
        >
          <Icon name="plus" />
        </button>
      </div>
      <form
        className="new-task"
        onSubmit={(event) => {
          event.preventDefault();
          if (taskName.trim()) onCreateTask();
        }}
      >
        <input
          value={taskName}
          onChange={(event) => onTaskNameChange(event.target.value)}
          placeholder="新任务名称"
        />
        <button type="submit" aria-label="新建任务">
          <Icon name="plus" />
          <span>新建任务</span>
        </button>
      </form>
      <div className="search-field">
        <Icon name="search" />
        <input
          className="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索任务"
        />
      </div>
      <div className="section-title">最近任务</div>
      <nav className="project-list">
        {projects.map((project) => (
          <div className="project-row" key={project.id}>
            <button
              type="button"
              className={selectedProjectId === project.id ? "project active" : "project"}
              onClick={() => onSelectProject(project.id)}
            >
              <span className={`status ${project.status}`} />
              <span>
                <strong>{project.name}</strong>
                <small>{new Date(project.updatedAt).toLocaleDateString()}</small>
              </span>
            </button>
            {pendingDeleteProjectId === project.id ? (
              <span className="project-delete-confirm">
                <button
                  type="button"
                  disabled={taskDeletePending || streaming}
                  onClick={() => onConfirmDeleteProject(project.id)}
                >
                  确认删除
                </button>
                <button type="button" onClick={onCancelDeleteProject}>
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="project-delete"
                aria-label={`删除最近任务“${project.name}”`}
                disabled={streaming}
                onClick={() => onRequestDeleteProject(project.id)}
              >
                <Icon name="trash" />
              </button>
            )}
          </div>
        ))}
        {taskDeleteError ? (
          <p className="project-delete-error" role="alert">
            {taskDeleteError}
          </p>
        ) : null}
      </nav>
      <section className="persona-sidebar-section" aria-labelledby="persona-sidebar-title">
        <header>
          <span className="persona-sidebar-icon">
            <Icon name="user" />
          </span>
          <span>
            <strong id="persona-sidebar-title">用户画像</strong>
            <small>
              {personaError ? "状态读取失败" : personaReady ? "画像已就绪" : "尚未构建"}
            </small>
          </span>
        </header>
        <div className={`persona-sidebar-meta ${agentState}`}>
          <span />
          {agentLabel}
          {personaReady ? ` · ${personaFileCount} 个本地文件` : ""}
        </div>
        <div className="persona-sidebar-buttons">
          <button
            type="button"
            className="persona-sidebar-primary"
            disabled={
              personaPending ||
              streaming ||
              personaSetupOpen ||
              personaReadPending ||
              personaDeletePending
            }
            onClick={onOpenPersona}
          >
            {personaSetupOpen
              ? "正在构建"
              : personaReadPending
                ? "正在打开…"
                : personaDocumentOpen
                  ? "正在查看画像"
                  : personaReady
                    ? "查看或更新画像"
                    : "开始构建画像"}
          </button>
          {personaReady ? (
            <button
              type="button"
              className="persona-sidebar-delete"
              aria-label="删除用户画像"
              title="删除用户画像"
              disabled={personaDeletePending}
              onClick={onRequestDeletePersona}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </div>
        {personaDocumentError && !personaDocumentOpen ? (
          <p className="persona-rag-error" role="alert">
            {personaDocumentError}
          </p>
        ) : null}
      </section>
      <div className="sidebar-footer">
        <button type="button" onClick={onOpenPublishCenter}>
          <span className="nav-label">
            <Icon name="file" /> 草稿区
          </span>
        </button>
        <button type="button">
          <span className="nav-label">
            <Icon name="monitor" /> 已配对设备
          </span>
          <span>0</span>
        </button>
        <button type="button">
          <span className="nav-label">
            <Icon name="wallet" /> 账户与余额
          </span>
          <span>—</span>
        </button>
        <button type="button" onClick={onOpenSettings}>
          <span className="nav-label">
            <Icon name="settings" /> 设置
          </span>
        </button>
      </div>
    </aside>
  );
}
