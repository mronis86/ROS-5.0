# Companion v3 Setup – Developer Module Path

## Why the module wasn’t showing

Companion v3 uses `companion/manifest.json` (not just `package.json`) to detect modules. Without it, the module is ignored.

## Setup steps

### 1. Path for Developer Module Path

The **Developer → Module path** in Companion must point to the **parent folder** of your module(s), not the module folder itself.

Example: if your module lives at:
```text
C:\Users\audre\OneDrive\Desktop\ROS-5.0\companion-module-runofshow
```

Set the Module path to:
```text
C:\Users\audre\OneDrive\Desktop\ROS-5.0
```

Companion will scan that folder for subfolders that contain `companion/manifest.json`.

### 2. Required files

Confirm this structure:

```
companion-module-runofshow/
├── companion/
│   ├── manifest.json   ← required
│   └── HELP.md
├── src/
│   ├── main.js
│   ├── actions.js
│   ├── feedbacks.js
│   ├── variables.js
│   └── upgrades.js
├── package.json
└── README.md
```

### 3. Install dependencies

Companion needs `node_modules` for `@companion-module/base`:

```bash
cd companion-module-runofshow
npm install
```

(or `yarn` if you use Yarn)

### 4. Restart Companion

After changing the Module path or files, fully restart Companion.

### 5. If it still doesn’t appear

- Try the **parent** of `companion-module-runofshow` as the Module path (see step 1).
- Check Companion’s log for errors about module loading.
- Confirm `companion/manifest.json` exists and is valid JSON.
- If using a dev build, ensure Node.js 22+ is available to Companion.

## Alternative: import as package

1. From `companion-module-runofshow` run: `npm install` then `npx companion-module-build`
2. In Companion: **Modules** → **Import module package** → select the generated `.tgz` file
