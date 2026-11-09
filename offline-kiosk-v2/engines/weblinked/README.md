# WebLinked (bundled runtime)

Hidden SDI/NDI URL→video engine used by the Displays tab.

- **Idea / upstream reference (untouched):** `Desktop\WebLinked-SDI`
- **What we ship here:** the built Windows runtime (`sinor-weblinked.exe` + CEF/NDI libs), not the C++ source tree
- **Control API:** HTTP `POST /api/url` (Sinor default port **7655**)

## Sync from the Desktop build

```bat
cd offline-kiosk-v2
npm run sync:weblinked
```

That copies `WebLinked-SDI\build\Release` → this folder. Rebuild upstream first if you changed WebLinked-SDI.
