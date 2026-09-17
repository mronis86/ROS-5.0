Companion Network Fix (Cisco Umbrella / TLS)
==========================================

Use these on show PCs where the Run of Show Companion module logs:
  API request failed: fetch failed
but the browser can still open:
  https://ros-50-production.up.railway.app/health

FOLDER
------
tools\companion-network-fix\

FILES
-----
1-start-companion-tls-fix.bat
  - Downloads the API TLS cert chain into .\certs\
  - Starts Companion with BOTH:
      NODE_EXTRA_CA_CERTS=...\certs\api-chain.pem   (option 3)
      NODE_TLS_REJECT_UNAUTHORIZED=0               (option 4)
  - Does NOT permanently change Windows env vars

2-start-companion-normal.bat
  - Starts Companion with TLS workarounds OFF (clean / "turn off")

download-api-cert-only.bat
  - Only downloads/saves the cert chain (does not start Companion)

HOW TO USE
----------
1. Close Companion completely (tray icon too).
2. Double-click: 1-start-companion-tls-fix.bat
3. Check the Run of Show module log.
4. When done / back on a normal network:
   Close Companion, then run: 2-start-companion-normal.bat

IF COMPANION IS NOT FOUND
-------------------------
In Command Prompt:
  setx COMPANION_EXE "C:\full\path\to\Companion.exe"
Then open a NEW Command Prompt / re-login and rerun the bat.

NOTES
-----
- Option 4 weakens TLS checking for that Companion session only.
  Use for show-day / known networks.
- If Umbrella fully blocks Companion, this cannot bypass IT policy.
- Downloaded certs land in .\certs\ (gitignored).
