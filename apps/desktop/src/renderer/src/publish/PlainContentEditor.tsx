import type { LocalPublishImage } from "@yoom/desktop-contracts";

export function PlainContentEditor({
  content,
  images,
  busy,
  onContentChange,
  onSelectImages,
  onRemoveImage,
  maxImages = 20,
}: {
  content: string;
  images: LocalPublishImage[];
  busy: boolean;
  onContentChange(value: string): void;
  onSelectImages(): void;
  onRemoveImage(image: LocalPublishImage): void;
  maxImages?: number;
}) {
  return (
    <>
      <label className="publish-content-field">
        推文内容
        <textarea
          value={content}
          maxLength={100_000}
          placeholder="可以直接输入任何想发布的内容…"
          onChange={(event) => onContentChange(event.target.value)}
        />
        <small>{content.length.toLocaleString()} 字</small>
      </label>
      <section className="publish-assets" aria-labelledby="publish-assets-title">
        <header>
          <div>
            <strong id="publish-assets-title">本地配图</strong>
            <small>图片会在正文之后统一上传，只记录原始路径和名称</small>
          </div>
          <button
            type="button"
            disabled={busy || images.length >= maxImages}
            onClick={onSelectImages}
          >
            选择本地图片
          </button>
        </header>
        <div className="publish-asset-list">
          {images.map((image, index) => (
            <div key={image.id} className="publish-image-item">
              <img src={image.previewUrl} alt="" />
              <span>
                <strong>
                  {index + 1}. {image.name}
                </strong>
                <small title={image.path}>{image.path}</small>
              </span>
              <button
                type="button"
                aria-label={`移除配图“${image.name}”`}
                disabled={busy}
                onClick={() => onRemoveImage(image)}
              >
                移除
              </button>
            </div>
          ))}
          {images.length === 0 ? <p>尚未选择配图</p> : null}
          {maxImages < 20 ? <p>当前平台最多选择 {maxImages} 张配图</p> : null}
        </div>
      </section>
    </>
  );
}
