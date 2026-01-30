/**
 * Get primary screen size. Windows: PowerShell; else env or default.
 * @returns {Promise<{ width: number; height: number }>}
 */
export async function getScreenSize() {
  const fromEnv = () => {
    const w = parseInt(process.env.SCREEN_WIDTH, 10);
    const h = parseInt(process.env.SCREEN_HEIGHT, 10);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
    return null;
  };

  if (process.platform === 'win32') {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const exec = promisify(execFile);
      const cmd = `Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output ($b.Width.ToString() + ',' + $b.Height.ToString())`;
      const { stdout } = await exec('powershell', ['-NoProfile', '-Command', cmd], { timeout: 3000 });
      const [w, h] = (stdout.trim() || '').split(',').map((n) => parseInt(n, 10));
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
    } catch (_) {}
  }

  return fromEnv() ?? { width: 1920, height: 1080 };
}
