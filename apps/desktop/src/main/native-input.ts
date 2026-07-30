import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clipboard } from "electron";

const execFileAsync = promisify(execFile);

export async function replaceTextWithSystemShortcut(content: string): Promise<void> {
  clipboard.writeText(content);
  if (process.platform === "darwin") {
    await runAppleScript(`
      tell application "System Events"
        keystroke "a" using command down
        delay 0.1
        key code 51
        delay 0.1
        keystroke "v" using command down
      end tell
    `);
    return;
  }
  if (process.platform === "win32") {
    await runPowerShell(`
      $shell = New-Object -ComObject WScript.Shell
      $shell.SendKeys('^a')
      Start-Sleep -Milliseconds 100
      $shell.SendKeys('{BACKSPACE}')
      Start-Sleep -Milliseconds 100
      $shell.SendKeys('^v')
    `);
    return;
  }
  throw new Error("当前仅支持 macOS 和 Windows 的系统粘贴操作");
}

export async function deleteTextBackwardWithSystemKeyboard(count: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 2) {
    throw new Error("要清理的 B 站尾部字符数量无效");
  }
  if (process.platform === "darwin") {
    await runAppleScript(`
      tell application "System Events"
        repeat ${count} times
          key code 51
          delay 0.05
        end repeat
      end tell
    `);
    return;
  }
  if (process.platform === "win32") {
    await runPowerShell(`
      $shell = New-Object -ComObject WScript.Shell
      1..${count} | ForEach-Object {
        $shell.SendKeys('{BACKSPACE}')
        Start-Sleep -Milliseconds 50
      }
    `);
    return;
  }
  throw new Error("当前仅支持 macOS 和 Windows 的系统键盘操作");
}

export async function chooseFileInSystemDialog(path: string): Promise<void> {
  if (process.platform === "darwin") {
    clipboard.writeText(path);
    await runAppleScript(`
      tell application "System Events"
        delay 0.5
        keystroke "g" using {command down, shift down}
        delay 0.3
        keystroke "v" using command down
        key code 36
        delay 0.5
        key code 36
      end tell
    `);
    return;
  }
  if (process.platform === "win32") {
    await runWindowsFileDialog(path);
    return;
  }
  throw new Error("当前仅支持 macOS 和 Windows 的系统文件选择窗口");
}

export async function clickWithSystemMouse(x: number, y: number): Promise<void> {
  const screenX = Math.round(x);
  const screenY = Math.round(y);
  if (process.platform === "darwin") {
    await runAppleScript(`
      tell application "System Events"
        click at {${screenX}, ${screenY}}
      end tell
    `);
    return;
  }
  if (process.platform === "win32") {
    await runPowerShell(`
      Add-Type @'
        using System;
        using System.Runtime.InteropServices;
        public static class YoomMouse {
          [DllImport("user32.dll")]
          public static extern bool SetCursorPos(int x, int y);
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
        }
'@
      [YoomMouse]::SetCursorPos(${screenX}, ${screenY}) | Out-Null
      Start-Sleep -Milliseconds 120
      [YoomMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 80
      [YoomMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    `);
    return;
  }
  throw new Error("当前仅支持 macOS 和 Windows 的系统鼠标点击");
}

export async function waitForSystemFileDialog(timeoutMilliseconds = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await isSystemFileDialogOpen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function isSystemFileDialogOpen(): Promise<boolean> {
  if (process.platform === "darwin") {
    const result = await runAppleScriptResult(`
      tell application "System Events"
        try
          set frontProcess to first application process whose frontmost is true
          if (count of windows of frontProcess) is 0 then return "false"
          set frontWindow to front window of frontProcess
          if (count of sheets of frontWindow) > 0 then return "true"
          try
            if value of attribute "AXSubrole" of frontWindow is "AXDialog" then return "true"
          end try
        end try
        return "false"
      end tell
    `);
    return result.trim() === "true";
  }
  if (process.platform === "win32") {
    const result = await runPowerShellResult(`
      Add-Type -AssemblyName UIAutomationClient
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      $window = $focused
      while ($null -ne $window -and
             $window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
        $window = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($window)
      }
      if ($null -eq $window) { Write-Output 'false'; exit }
      $fileNameCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        '1148'
      )
      $fileName = $window.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $fileNameCondition
      )
      Write-Output ($null -ne $fileName)
    `);
    return result.trim().toLowerCase() === "true";
  }
  return false;
}

async function runWindowsFileDialog(path: string): Promise<void> {
  await runPowerShell(
    `
      Add-Type -AssemblyName UIAutomationClient
      Start-Sleep -Milliseconds 500
      $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
      $window = $focused
      while ($null -ne $window -and
             $window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
        $window = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($window)
      }
      if ($null -eq $window) { throw '没有识别到系统文件选择窗口' }

      $fileNameCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        '1148'
      )
      $fileName = $window.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $fileNameCondition
      )
      if ($null -eq $fileName) { throw '没有识别到文件名输入框' }
      $valuePattern = $fileName.GetCurrentPattern(
        [System.Windows.Automation.ValuePattern]::Pattern
      )
      $valuePattern.SetValue($env:YOOM_PUBLISH_IMAGE_PATH)

      $openCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        '1'
      )
      $openButton = $window.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $openCondition
      )
      if ($null -eq $openButton) { throw '没有识别到打开按钮' }
      $invokePattern = $openButton.GetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern
      )
      $invokePattern.Invoke()
    `,
    { YOOM_PUBLISH_IMAGE_PATH: path },
  );
}

async function runAppleScript(script: string): Promise<void> {
  try {
    await execFileAsync("osascript", ["-e", script]);
  } catch {
    throw new Error(
      "系统键盘操作失败。请在“系统设置 → 隐私与安全 → 辅助功能”中允许本应用控制电脑。",
    );
  }
}

async function runAppleScriptResult(script: string): Promise<string> {
  try {
    const result = await execFileAsync("osascript", ["-e", script]);
    return result.stdout;
  } catch {
    return "";
  }
}

async function runPowerShell(
  script: string,
  extraEnvironment: Record<string, string> = {},
): Promise<void> {
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: {
          ...process.env,
          ...extraEnvironment,
        },
      },
    );
  } catch {
    throw new Error("Windows 系统自动操作失败，请确认文件选择窗口位于最前方后重试。");
  }
}

async function runPowerShellResult(script: string): Promise<string> {
  try {
    const result = await execFileAsync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return result.stdout;
  } catch {
    return "";
  }
}
