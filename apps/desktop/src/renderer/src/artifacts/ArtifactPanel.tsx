import type { Artifact, FilePreview } from "@yoom/desktop-contracts";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../ui/Icon";
import { ArtifactList } from "./ArtifactList";

export function ArtifactPanel({
  inert,
  artifacts,
  selectedPath,
  preview,
  onSelect,
  onRefresh,
  onOpen,
  onReveal,
  onSendToPublishCenter,
}: {
  inert: boolean;
  artifacts: Artifact[];
  selectedPath: string | null;
  preview: FilePreview | null;
  onSelect(path: string): void;
  onRefresh(): void;
  onOpen(): void;
  onReveal(): void;
  onSendToPublishCenter(artifact: Artifact | undefined, preview: FilePreview): void;
}) {
  return (
    <aside className="artifacts" aria-hidden={inert} inert={inert ? true : undefined}>
      <header>
        <div>
          <strong>生成物</strong>
          <small>{artifacts.length} 个文件</small>
        </div>
        <button type="button" onClick={onRefresh}>
          <Icon name="refresh" />
        </button>
      </header>
      <ArtifactList artifacts={artifacts} selected={selectedPath} onSelect={onSelect} />
      <div className="preview">
        {!selectedPath && (
          <div className="empty-preview">
            <span className="preview-icon">
              <Icon name="file" />
            </span>
            <strong>暂无预览</strong>
            <p>Agent 生成的文章、图片和报告会出现在这里</p>
          </div>
        )}
        {preview?.content && preview.mediaType === "text/markdown" && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown>
        )}
        {preview?.content && preview.mediaType !== "text/markdown" && <pre>{preview.content}</pre>}
        {preview && !preview.content && (
          <div className="empty-preview">
            <p>请使用系统应用打开此文件。</p>
          </div>
        )}
      </div>
      {preview && (
        <footer className="file-actions">
          <button type="button" onClick={onOpen}>
            打开
          </button>
          <button type="button" onClick={onReveal}>
            显示位置
          </button>
          <button type="button" onClick={() => navigator.clipboard.writeText(preview.path)}>
            复制路径
          </button>
          {preview.content ? (
            <button
              type="button"
              onClick={() =>
                onSendToPublishCenter(
                  artifacts.find((entry) => entry.path === selectedPath),
                  preview,
                )
              }
            >
              转入草稿区
            </button>
          ) : null}
        </footer>
      )}
    </aside>
  );
}
