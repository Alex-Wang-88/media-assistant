export const X_SELECTORS = {
  composer: '[data-testid="tweetTextarea_0"][contenteditable="true"]',
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  profileLink: 'a[data-testid="AppTabBar_Profile_Link"]',
  fileInput: 'input[data-testid="fileInput"][type="file"]',
  mediaContainer: '[data-testid="attachments"] [data-testid="mediaContainer"]',
  postButtons: [
    '[data-testid="tweetButton"]:not([aria-disabled="true"])',
    '[data-testid="tweetButtonInline"]:not([aria-disabled="true"])',
  ],
} as const;
