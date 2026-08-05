export const ZHIHU_SELECTORS = {
  title: [
    ".WriteIndex-titleInput textarea",
    "textarea[placeholder*='标题']",
    "input[placeholder*='标题']",
    "[data-testid='article-title'] textarea",
  ],
  body: [
    ".DraftEditor-editorContainer .public-DraftEditor-content[contenteditable='true']",
    ".ProseMirror[contenteditable='true']",
    "[data-placeholder*='正文'][contenteditable='true']",
    "[contenteditable='true'][role='textbox']",
  ],
  imageControl: [
    "button[aria-label*='图片']",
    "button[title*='图片']",
    "button[data-tooltip*='图片']",
    "button[aria-label*='插图']",
    "button[title*='插图']",
  ],
} as const;
