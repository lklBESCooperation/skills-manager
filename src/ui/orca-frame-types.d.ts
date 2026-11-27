export type OrcaDisposable = {
  dispose(): void
}

export type OrcaThemeEvent = {
  colorScheme: 'light' | 'dark'
}

export type OrcaSaveAsOptions = {
  data: Uint8Array | ArrayBuffer | string
  suggestedName?: string
  mimeType?: string
}

export type OrcaFrameApi = {
  readonly api: { readonly major: number; readonly minor: number }
  readonly locale: string
  host: {
    call(method: string, params?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
    has(method: string): boolean
  }
  on(event: string, fn: (payload: unknown) => void): OrcaDisposable
  plugin: {
    request<T = unknown>(
      name: string,
      input?: unknown,
      options?: { timeoutMs?: number; signal?: AbortSignal }
    ): Promise<T>
    on(event: string, fn: (payload: unknown) => void): OrcaDisposable
  }
  navigation: {
    openPage(pageId: string): Promise<{ opened?: boolean }>
  }
  shell?: {
    openExternal(url: string): Promise<void>
  }
  files?: {
    saveAs(options: OrcaSaveAsOptions): Promise<{ status: 'saved' | 'cancelled' }>
  }
}

declare global {
  interface Window {
    orca?: OrcaFrameApi
  }
}

export {}
