export function logError(...args: any[]): void {
  try { if (__DEV__) console.error(...args) } catch {}
}
