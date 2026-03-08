export function logError(...args: any[]): void {
  try { console.error(...args) } catch {}
}
