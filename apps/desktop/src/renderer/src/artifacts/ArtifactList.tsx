import type { Artifact } from "@yoom/desktop-contracts";

export function ArtifactList({
  artifacts,
  selected,
  onSelect,
}: {
  artifacts: Artifact[];
  selected: string | null;
  onSelect(path: string): void;
}) {
  const labels: Record<Artifact["kind"], string> = {
    article: "文章",
    image: "图片",
    analytics_report: "分析报告",
    strategy: "创作策略",
    video: "视频",
    publish_receipt: "发布回执",
    input: "输入文件",
  };
  const grouped = Object.groupBy(artifacts, (artifact) => artifact.kind);
  return (
    <div className="artifact-list">
      {Object.entries(grouped).map(([kind, items]) => (
        <section key={kind}>
          <h3>
            {labels[kind as Artifact["kind"]]} <span>{items?.length ?? 0}</span>
          </h3>
          {items?.map((artifact) => (
            <button
              type="button"
              key={artifact.path}
              className={selected === artifact.path ? "active" : ""}
              onClick={() => onSelect(artifact.path)}
            >
              <span className="file-icon">
                {artifact.mediaType.startsWith("image/") ? "▧" : "▤"}
              </span>
              <span>
                <strong>{artifact.name}</strong>
                <small>{new Date(artifact.updatedAt).toLocaleString()}</small>
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
