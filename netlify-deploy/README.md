# Deprecated — use dated deploy folder

Upload deploys now use **`netlify-YYYY-MM-DD-V2`** (e.g. `netlify-2026-06-07-V2`).

From the repo root, run:

```bat
create-netlify-deploy.bat
```

or:

```powershell
.\create-netlify-dated.ps1
```

Then drag the dated folder to Netlify **Deploys**.

This `netlify-deploy/` path is no longer populated by the build scripts.
