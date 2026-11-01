// The pinned package exposes modular browser entry points without subpath declarations.
declare module 'exifr/src/core.mjs' {
  export function parse(input: Uint8Array, options: {
    pick: readonly string[]
    reviveValues: boolean
    silentErrors: boolean
  }): Promise<Record<string, unknown> | undefined>
}
declare module 'exifr/src/file-parsers/*.mjs'
declare module 'exifr/src/segment-parsers/*.mjs'
declare module 'exifr/src/dicts/*.mjs'
