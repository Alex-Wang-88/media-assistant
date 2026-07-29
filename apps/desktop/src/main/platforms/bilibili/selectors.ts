export const BILIBILI_SELECTORS = {
  composer: ".bili-dyn-publishing",
  title: ".bili-dyn-publishing__title__input",
  body: '.bili-rich-textarea__inner[contenteditable="true"]',
  initialImageButton: ".bili-dyn-publishing__tools__item.pic",
  activeImageButton: ".bili-dyn-publishing__tools__item.pic.active",
  imagePanel: ".bili-pics-uploader",
  addImageButton: ".bili-pics-uploader__add",
  imageItem: ".bili-pics-uploader__item",
  removeImageButton: ".bili-pics-uploader__item__remove",
  completedImageItem:
    ".bili-pics-uploader__item:not(.loading) .bili-pics-uploader-item-preview__pic",
  publishButton: ".bili-dyn-publishing__action.launcher:not(.disabled)",
} as const;
