/**
 * Decide whether the foreground window is a fullscreen app (video, game, slideshow) so the
 * pet can step aside. The watcher is per-monitor DPI aware, so it reports the foreground
 * window rect in physical pixels; display rects must be physical too (screen.dipToScreenRect).
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ForegroundInfo {
  left: number
  top: number
  right: number
  bottom: number
  className: string
}

/** Desktop, taskbar and shell windows are never "fullscreen apps". */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', ''])

export function parseForegroundLine(line: string): ForegroundInfo | null {
  const parts = line.trim().split(',')
  if (parts.length < 5) return null
  const [l, t, r, b] = parts.slice(0, 4).map(Number)
  if ([l, t, r, b].some((n) => !Number.isFinite(n))) return null
  return { left: l, top: t, right: r, bottom: b, className: parts.slice(4).join(',') }
}

/** True when the window covers an entire display (all rects in physical pixels, 2px tolerance). */
export function isFullscreen(fg: ForegroundInfo, displays: Rect[]): boolean {
  if (SHELL_CLASSES.has(fg.className)) return false
  if (fg.right - fg.left <= 0 || fg.bottom - fg.top <= 0) return false
  const tol = 2
  return displays.some((d) => fg.left <= d.x + tol && fg.top <= d.y + tol && fg.right >= d.x + d.width - tol && fg.bottom >= d.y + d.height - tol)
}

/** PowerShell loop printing "left,top,right,bottom,className" of the foreground window every few seconds. */
export const WINDOWS_WATCH_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class SoulPetFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  public static void DpiAware() { try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { } SetProcessDPIAware(); }
  public static string Probe() {
    IntPtr h = GetForegroundWindow(); RECT r; GetWindowRect(h, out r);
    StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256);
    return r.L + "," + r.T + "," + r.R + "," + r.B + "," + sb.ToString();
  }
}
"@
[SoulPetFg]::DpiAware()
while ($true) { [Console]::Out.WriteLine([SoulPetFg]::Probe()); [Console]::Out.Flush(); Start-Sleep -Seconds 3 }
`
