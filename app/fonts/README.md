Self-hosted copies of the site fonts (Latin subset, woff2), taken from the
Fontsource npm packages. All four families are licensed under the SIL Open
Font License 1.1: Archivo, Inter, Instrument Serif, IBM Plex Mono.

They live in the repo so `next build` never has to download from Google
Fonts. A failed download there broke two production builds on 2026-10-31.
