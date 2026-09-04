import type { ZhihuContentBlock } from "@yoom/desktop-contracts";
import type { MemoryPublishDraft } from "./publish-draft-model";

export function ZhihuBlockEditor({
  draft,
  busy,
  onInsertImage,
  onMoveBlock,
  onRemoveBlock,
  onUpdateBlocks,
  onAddTextBlock,
}: {
  draft: MemoryPublishDraft;
  busy: boolean;
  onInsertImage(index: number): void;
  onMoveBlock(index: number, offset: -1 | 1): void;
  onRemoveBlock(block: ZhihuContentBlock): void;
  onUpdateBlocks(blocks: ZhihuContentBlock[]): void;
  onAddTextBlock(): void;
}) {
  const blocks = draft.zhihuBlocks ?? [];
  return (
    <section className="publish-zhihu-editor" aria-labelledby="publish-zhihu-title">
      <header>
        <div>
          <strong id="publish-zhihu-title">知乎文章结构</strong>
          <small>段落与图片会按这里的顺序填入；图片注释为可选项</small>
        </div>
        <span>{draft.images.length}/20 张图片</span>
      </header>
      <div className="publish-zhihu-blocks">
        {blocks.map((block, blockIndex) => {
          const image =
            block.type === "image"
              ? draft.images.find((entry) => entry.id === block.imageId)
              : null;
          return (
            <div className="publish-zhihu-block-row" key={block.id}>
              <button
                type="button"
                className="publish-zhihu-insert"
                disabled={busy || draft.images.length >= 20}
                onClick={() => onInsertImage(blockIndex)}
              >
                ＋ 在此处插入图片
              </button>
              <article className={`publish-zhihu-block ${block.type}`}>
                <header>
                  <strong>
                    {block.type === "text" ? "文字段落" : (image?.name ?? "本地图片")}
                  </strong>
                  <span>
                    <button
                      type="button"
                      disabled={busy || blockIndex === 0}
                      onClick={() => onMoveBlock(blockIndex, -1)}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      disabled={busy || blockIndex === blocks.length - 1}
                      onClick={() => onMoveBlock(blockIndex, 1)}
                    >
                      下移
                    </button>
                    <button type="button" disabled={busy} onClick={() => onRemoveBlock(block)}>
                      移除
                    </button>
                  </span>
                </header>
                {block.type === "text" ? (
                  <textarea
                    value={block.content}
                    maxLength={100_000}
                    placeholder="输入这一段正文…"
                    onChange={(event) =>
                      onUpdateBlocks(
                        blocks.map((entry) =>
                          entry.id === block.id && entry.type === "text"
                            ? { ...entry, content: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                ) : (
                  <div className="publish-zhihu-image-block">
                    {image ? <img src={image.previewUrl} alt="" /> : null}
                    <label>
                      图片注释（可选）
                      <textarea
                        value={block.caption}
                        maxLength={140}
                        placeholder="添加图片注释，不超过 140 字…"
                        onChange={(event) =>
                          onUpdateBlocks(
                            blocks.map((entry) =>
                              entry.id === block.id && entry.type === "image"
                                ? { ...entry, caption: event.target.value }
                                : entry,
                            ),
                          )
                        }
                      />
                      <small>{block.caption.length}/140</small>
                    </label>
                  </div>
                )}
              </article>
            </div>
          );
        })}
        <button
          type="button"
          className="publish-zhihu-insert"
          disabled={busy || draft.images.length >= 20}
          onClick={() => onInsertImage(blocks.length)}
        >
          ＋ 在末尾插入图片
        </button>
        <button
          type="button"
          className="publish-zhihu-add-text"
          disabled={busy}
          onClick={onAddTextBlock}
        >
          ＋ 新增文字段落
        </button>
      </div>
    </section>
  );
}
