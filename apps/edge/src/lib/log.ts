// Workers send console output to the platform's logs; this is the only place allowed to use it.
export const log = {
  error(message: string, detail?: unknown) {
    // biome-ignore lint/suspicious/noConsole: platform logging
    console.error(
      JSON.stringify({ level: 'error', message, detail: detail instanceof Error ? detail.message : detail }),
    )
  },
  warn(message: string, detail?: unknown) {
    // biome-ignore lint/suspicious/noConsole: platform logging
    console.warn(JSON.stringify({ level: 'warn', message, detail }))
  },
}
