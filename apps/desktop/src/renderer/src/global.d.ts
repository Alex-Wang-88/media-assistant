import type { DesktopApi } from "@yoom/desktop-contracts";

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
