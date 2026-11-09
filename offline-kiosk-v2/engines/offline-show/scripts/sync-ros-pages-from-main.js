/**
 * Bring offline-show ROS pages in line with main src/.
 * Copies libs/components needed by Run of Show + ScheduleRow, then re-applies
 * offline-only patches (auth, cloud reconnect, /timer routes).
 *
 * Usage (from repo root or offline-show):
 *   node offline-show/scripts/sync-ros-pages-from-main.js
 */
const fs = require('fs');
const path = require('path');

const offlineRoot = path.join(__dirname, '..');
const repoRoot = path.join(offlineRoot, '..');
const mainSrc = path.join(repoRoot, 'src');
const offSrc = path.join(offlineRoot, 'ui', 'src');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(relFromSrc, relToOff = relFromSrc) {
  const from = path.join(mainSrc, relFromSrc);
  const to = path.join(offSrc, relToOff);
  if (!fs.existsSync(from)) {
    console.warn('skip missing', relFromSrc);
    return false;
  }
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
  console.log('copied', relFromSrc, '->', relToOff);
  return true;
}

function writeStub(relToOff, exportName) {
  const to = path.join(offSrc, relToOff);
  ensureDir(path.dirname(to));
  const isNamed = exportName.startsWith('{');
  const body = isNamed
    ? `import React from 'react';\nexport ${exportName} = (_props: Record<string, unknown>) => null;\n`
    : `import React from 'react';\nconst ${exportName}: React.FC<Record<string, unknown>> = () => null;\nexport default ${exportName};\n`;
  fs.writeFileSync(to, body);
  console.log('stub', relToOff);
}

const LIBS = [
  'lib/autoRoll.ts',
  'lib/backupPreview.ts',
  'lib/cueDisplay.ts',
  'lib/cueFileVersions.ts',
  'lib/extendEventControls.ts',
  'lib/guestRosHelpers.ts',
  'lib/notesContrast.ts',
  'lib/operatorCountdown.ts',
  'lib/OvertimeClockText.tsx',
  'lib/overtimeSign.ts',
  'lib/rehearsalBaseline.ts',
  'lib/rosColumnOrder.ts',
  'lib/scheduleCheckboxMerge.ts',
  'lib/sessionRoleLabels.ts',
  'lib/showBreak.ts',
  'lib/speakerLocations.ts',
  'lib/userUiPreferences.ts',
  'lib/dsmClockLayout.ts',
  'lib/segmentNameSpellcheck.ts',
  'lib/loginRateLimit.ts',
  // Already present but may be stale — refresh helpers ROS depends on
  'lib/audioCallouts.ts',
  'lib/notesLabelSuggest.ts',
  'lib/cueRenumber.ts',
  'lib/preshowCountdown.ts',
  'lib/usePreshowRainbow.ts',
  'lib/rosProgramTypeSplit.ts',
  'lib/shotTypeFromSpeakers.ts',
  'lib/showDelay.ts',
  'lib/cueRecording.ts',
  'lib/eventLocalClock.ts',
  'lib/liveStartProjection.ts',
  'lib/scheduleStartTime.ts',
  'lib/timedMarker.ts',
  'lib/scheduleClockFormat.ts',
  'lib/preflightChecklist.ts',
  'lib/branding.ts',
  'lib/countdownColor.ts',
  'lib/adminAuth.ts',
  'lib/sessionAuth.ts',
  'lib/rosProgramTypes.ts',
];

const COMPONENTS_FULL = [
  'components/NotesLabelSuggestBanner.tsx',
  'components/CueReorderNumberModal.tsx',
  'components/RoleSelectionModal.tsx', // will re-patch offline role modal after if needed
  'components/TimeToastIcon.tsx',
  'components/ConfirmModal.tsx',
  'components/PinNotesColumnModal.tsx',
  'components/AltTimerBadge.tsx',
  'components/StartTimeColumnCell.tsx',
  'components/SegmentSpellingFlag.tsx',
  'components/DuplicateCueFlag.tsx',
];

const COMPONENT_STUBS = [
  ['components/VogModal.tsx', 'VogModal'],
  ['components/ComplaintLineModal.tsx', 'ComplaintLineModal'],
  ['components/ComplaintLineFab.tsx', 'ComplaintLineFab'],
  ['components/PreFlightChecklistModal.tsx', 'PreFlightChecklistModal'],
  ['components/OperatorCountdownModal.tsx', 'OperatorCountdownModal'],
  ['components/TimedMarkerModal.tsx', '{ TimedMarkerModalResult };\nconst TimedMarkerModal'],
  ['components/ShowVsRehearsalPanel.tsx', 'ShowVsRehearsalPanel'],
  ['components/AssetRetentionNotice.tsx', 'AssetRetentionNotice'],
  ['components/CuePlatformFileList.tsx', 'CuePlatformFileList'],
  ['components/PptPendingDeckBanner.tsx', '{ OperatorPptPendingDecks };\nconst PptPendingDeckBanner'],
  ['components/StageDirectionModal.tsx', 'StageDirectionModal'],
  ['components/ExcelImportModal.tsx', 'ExcelImportModal'],
  ['components/AgendaImportModal.tsx', 'AgendaImportModal'],
  ['components/ImportCSVModal.tsx', 'ImportCSVModal'],
  ['components/ImportEventModal.tsx', 'ImportEventModal'],
  ['components/OSCModal.tsx', 'OSCModal'],
  ['components/OSCModalSimple.tsx', 'OSCModalSimple'],
  ['components/OSCModalSimplified.tsx', 'OSCModalSimplified'],
  ['components/CompleteChangeLog.tsx', 'CompleteChangeLog'],
];

console.log('=== copy libs ===');
for (const rel of LIBS) copyFile(rel);

console.log('=== copy components ===');
for (const rel of COMPONENTS_FULL) copyFile(rel);

console.log('=== stub heavy/optional components ===');
for (const [rel, name] of COMPONENT_STUBS) {
  // Special stubs with named exports need hand-written content
  if (rel.includes('TimedMarkerModal')) {
    const to = path.join(offSrc, rel);
    fs.writeFileSync(
      to,
      `import React from 'react';\nexport type TimedMarkerModalResult = Record<string, unknown>;\nconst TimedMarkerModal: React.FC<Record<string, unknown>> = () => null;\nexport default TimedMarkerModal;\n`
    );
    console.log('stub', rel);
  } else if (rel.includes('PptPendingDeckBanner')) {
    const to = path.join(offSrc, rel);
    fs.writeFileSync(
      to,
      `import React from 'react';\nexport const OperatorPptPendingDecks: React.FC<Record<string, unknown>> = () => null;\nconst PptPendingDeckBanner: React.FC<Record<string, unknown>> = () => null;\nexport default PptPendingDeckBanner;\n`
    );
    console.log('stub', rel);
  } else {
    writeStub(rel, name);
  }
}

console.log('=== contexts ===');
copyFile('contexts/AppHeaderCollapseContext.tsx');
copyFile('contexts/LiveSyncStatusContext.tsx');

console.log('=== slim auth-service ===');
{
  const to = path.join(offSrc, 'services', 'auth-service.ts');
  fs.writeFileSync(
    to,
    `/** Offline-safe role helpers (no Neon login stack). */\n` +
      `type User = {\n` +
      `  is_admin?: boolean;\n` +
      `  is_event_manager?: boolean;\n` +
      `  is_producer?: boolean;\n` +
      `  is_bts_crew?: boolean;\n` +
      `  is_catering?: boolean;\n` +
      `  is_comms?: boolean;\n` +
      `  is_creative?: boolean;\n` +
      `  dashboard_enabled?: boolean;\n` +
      `};\n\n` +
      `export function canAccessAdmin(user: User | null | undefined): boolean {\n` +
      `  return user?.is_admin === true;\n` +
      `}\n\n` +
      `export function canAccessAccessManager(user: User | null | undefined): boolean {\n` +
      `  if (!user) return false;\n` +
      `  if (user.is_admin) return true;\n` +
      `  return user.is_event_manager === true || user.is_producer === true || user.is_bts_crew === true;\n` +
      `}\n\n` +
      `export function canAccessPreFlightChecklist(user: User | null | undefined): boolean {\n` +
      `  if (!user) return false;\n` +
      `  if (user.is_admin) return true;\n` +
      `  return user.is_bts_crew === true;\n` +
      `}\n\n` +
      `/** Offline show laptop: Operator always allowed for local roles. */\n` +
      `export function canSelectOperatorRole(_user: User | null | undefined): boolean {\n` +
      `  return true;\n` +
      `}\n`
  );
  console.log('wrote services/auth-service.ts');
}

console.log('=== pages: RunOfShow + ScheduleRow ===');
const rosBackup = path.join(offSrc, 'pages', 'RunOfShowPage.offline-backup.tsx');
const rosMain = path.join(mainSrc, 'pages', 'RunOfShowPage.tsx');
const rosOut = path.join(offSrc, 'pages', 'RunOfShowPage.tsx');
if (!fs.existsSync(rosBackup)) {
  fs.copyFileSync(rosOut, rosBackup);
  console.log('created backup RunOfShowPage.offline-backup.tsx');
}
fs.copyFileSync(rosMain, rosOut);
fs.copyFileSync(
  path.join(mainSrc, 'pages', 'ScheduleRow.tsx'),
  path.join(offSrc, 'pages', 'ScheduleRow.tsx')
);
console.log('copied RunOfShowPage + ScheduleRow from main');

// --- Extract reconnect block from backup ---
const backup = fs.readFileSync(rosBackup, 'utf8');
const reconnectMatch = backup.match(
  /  useEffect\(\(\) => \{\r?\n    registerRunOfShowLocalFlush[\s\S]*?return \(\) => clearRunOfShowReconnectHandlers\(\);\r?\n  \}, \[[\s\S]*?\n  \]\);\r?\n\r?\n  \/\/ Load master change log from API/
);
if (!reconnectMatch) {
  console.error('FATAL: could not extract reconnect useEffect from backup');
  process.exit(1);
}
const reconnectBlock = reconnectMatch[0].replace(
  /\r?\n  \/\/ Load master change log from API$/,
  ''
);

const refBlockMatch = backup.match(
  /  \/\*\* Latest timer UI for cloud reconnect[\s\S]*?userRole: 'OPERATOR' as string,\r?\n  \}\);/
);
const reconnectRefBlock = refBlockMatch
  ? refBlockMatch[0]
  : `  /** Latest timer UI for cloud reconnect — refs avoid stale state when toggling Cloud on. */
  const reconnectTimerStateRef = useRef({
    hybridTimerData: { activeTimer: null as Record<string, unknown> | null },
    activeItemId: null as number | null,
    activeTimers: {} as Record<number, boolean>,
    loadedItems: {} as Record<number, boolean>,
    timerProgress: {} as Record<number, { elapsed: number; total: number; startedAt: Date | null }>,
    schedule: [] as any[],
    eventId: null as string | undefined,
    userId: null as string | undefined,
    userName: '',
    userRole: 'OPERATOR' as string,
    completedCues: {} as Record<number, boolean>,
  });`;

let target = fs.readFileSync(rosOut, 'utf8');

// Auth
target = target.replace(
  "import { useAuth } from '../contexts/AuthContext';",
  "import { useAuth } from '../contexts/OfflineAuthContext';"
);

// Offline sync bridge import + helpers (after scheduleStartTime import cluster — insert after showBreak import block end / before useAuth)
if (!target.includes('offline-sync-bridge')) {
  target = target.replace(
    "import { useAuth } from '../contexts/OfflineAuthContext';",
    `import {
  clearRunOfShowReconnectHandlers,
  registerRunOfShowLocalFlush,
  registerRunOfShowSnapshotBuilder,
  registerPostCloudReconnectHandler,
  isCloudReconnecting,
  isCloudReconnectUploadActive,
  shouldIgnoreRemoteSchedule,
  markLocalMutationGuard,
  type ReconnectSnapshot,
} from '../services/offline-sync-bridge';

function eventIdsMatch(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

import { useAuth } from '../contexts/OfflineAuthContext';`
  );
}

// socket-client: keep offline onCloudModeChange if main lacks it
if (!target.includes('onCloudModeChange') && backup.includes('onCloudModeChange')) {
  target = target.replace(
    "import { socketClient } from '../services/socket-client';",
    "import { socketClient, onCloudModeChange } from '../services/socket-client';"
  );
}

// Inject reconnect ref after loadedItems state (common anchor)
if (!target.includes('reconnectTimerStateRef')) {
  if (target.includes('const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});')) {
    target = target.replace(
      '  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});',
      `  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});\n${reconnectRefBlock}`
    );
  } else {
    console.warn('warn: loadedItems anchor missing; prepend reconnect ref near top of component may be needed');
  }
}

// Inject reconnect effect before master change log loader
if (!target.includes('registerRunOfShowLocalFlush')) {
  const anchors = [
    '  // Load master change log from API',
    '  const loadMasterChangeLog = async () => {',
  ];
  let injected = false;
  for (const a of anchors) {
    if (target.includes(a)) {
      target = target.replace(a, `${reconnectBlock}\n\n${a}`);
      injected = true;
      break;
    }
  }
  if (!injected) {
    console.error('FATAL: could not find anchor to inject reconnect effect');
    process.exit(1);
  }
}

// Timer / clock routes → offline /timer
target = target.replace(/\bconst openClock = /g, 'const openTimerDisplay = ');
// Prefer /timer URLs
target = target.replace(
  /`\/clock\?eventId=\$\{encodeURIComponent\(event\.id\)\}`/g,
  '`/timer?eventId=${encodeURIComponent(event.id)}`'
);
target = target.replace(/`\/clock\?eventId=\$\{event\.id\}`/g, '`/timer?eventId=${encodeURIComponent(event.id)}`');
target = target.replace(/: '\/clock'/g, ": '/timer'");
target = target.replace(/: `\/clock`/g, ": '/timer'");
target = target.replace(/'\/clock\?/g, "'/timer?");
target = target.replace(/`\/clock\?/g, '`/timer?');
// Window name
target = target.replace(/'rosClock'/g, "'offlineShowTimer'");
target = target.replace(/'clock'/g, "'offlineShowTimer'");

// DisplayModal props: map clock/fullscreen/dsm to offline timer opener
target = target.replace(/onSelectClock=\{openClock\}/g, 'onSelectOfflineTimer={openTimerDisplay}');
target = target.replace(/onSelectClock=\{openTimerDisplay\}/g, 'onSelectOfflineTimer={openTimerDisplay}');
// If main passes separate fullscreen + clock + dsm, collapse to offline modal API
target = target.replace(
  /onSelectFullscreenTimer=\{[^}]+\}\s*\r?\n\s*onSelectClock=\{[^}]+\}/g,
  'onSelectOfflineTimer={openTimerDisplay}'
);
target = target.replace(/\s*onSelectDsmClock=\{[^}]+\}/g, '');

// Cloud reconnect guards on key socket handlers
target = target.replace(
  /onTimerUpdated: \(data: any\) => \{\r?\n(\s*)console\.log\('📡 RunOfShow: Event ID check:'/,
  `onTimerUpdated: (data: any) => {\n$1if (isCloudReconnecting()) {\n$1  console.log('⏭️ Skipping timer WebSocket update during cloud reconnect');\n$1  return;\n$1}\n$1console.log('📡 RunOfShow: Event ID check:'`
);

// event id match helpers for timer payloads
target = target.replace(
  /data && data\.event_id === event\?\.id/g,
  'data && eventIdsMatch(data.event_id, event?.id)'
);
target = target.replace(
  /timerData && timerData\.event_id === event\?\.id/g,
  'timerData && eventIdsMatch(timerData.event_id, event?.id)'
);

fs.writeFileSync(rosOut, target);
console.log('patched RunOfShowPage for offline');

// Restore offline RoleSelectionModal (uses offline-user)
const roleBackupCandidates = [
  path.join(offSrc, 'components', 'RoleSelectionModal.tsx'),
];
// Re-copy from git? We overwrote with main. Restore offline-specific from backup if we saved it.
// Prefer keeping a known offline RoleSelectionModal — re-read from git show if needed.
// For now: if main RoleSelectionModal imports AuthContext, patch to OfflineAuthContext
{
  const rolePath = path.join(offSrc, 'components', 'RoleSelectionModal.tsx');
  let role = fs.readFileSync(rolePath, 'utf8');
  role = role.replace(
    "from '../contexts/AuthContext'",
    "from '../contexts/OfflineAuthContext'"
  );
  fs.writeFileSync(rolePath, role);
}

// DisplayModal: keep offline version API (do not overwrite with main)
console.log('kept offline DisplayModal (onSelectOfflineTimer)');

// api-client: ensure EventCueFile / SpeakerDirectoryRow types exist
{
  const apiPath = path.join(offSrc, 'services', 'api-client.ts');
  let api = fs.readFileSync(apiPath, 'utf8');
  if (!api.includes('export type EventCueFile')) {
    api =
      `export type EventCueFile = {\n` +
      `  id?: string;\n` +
      `  name?: string;\n` +
      `  file_name?: string;\n` +
      `  url?: string;\n` +
      `  [key: string]: unknown;\n` +
      `};\n\n` +
      `export type SpeakerDirectoryRow = {\n` +
      `  id?: string;\n` +
      `  full_name?: string;\n` +
      `  [key: string]: unknown;\n` +
      `};\n\n` +
      api;
    fs.writeFileSync(apiPath, api);
    console.log('added EventCueFile / SpeakerDirectoryRow types to api-client');
  }
}

// neon-backup-service: AutoBackupLease type if missing
{
  const nb = path.join(offSrc, 'services', 'neon-backup-service.ts');
  let text = fs.readFileSync(nb, 'utf8');
  if (!text.includes('AutoBackupLease')) {
    text = `export type AutoBackupLease = { release?: () => void; [key: string]: unknown };\n` + text;
    fs.writeFileSync(nb, text);
    console.log('added AutoBackupLease type');
  }
}

console.log('=== sync-ros-pages-from-main done ===');
