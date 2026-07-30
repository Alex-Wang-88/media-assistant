const BILIBILI_EDITOR_SENTINEL = "\u200b";
const CONFIRMED_TRAILING_PASTE_ARTIFACT = " \n";

function withoutBilibiliEditorSentinel(actual: string, expected: string): string {
  return actual.startsWith(BILIBILI_EDITOR_SENTINEL) &&
    actual.slice(BILIBILI_EDITOR_SENTINEL.length).startsWith(expected)
    ? actual.slice(BILIBILI_EDITOR_SENTINEL.length)
    : actual;
}

export function countConfirmedTrailingPasteCleanupKeystrokes(
  actual: string,
  expected: string,
): number {
  const editorText = withoutBilibiliEditorSentinel(actual, expected);
  return editorText === `${expected}${CONFIRMED_TRAILING_PASTE_ARTIFACT}` ? 1 : 0;
}
