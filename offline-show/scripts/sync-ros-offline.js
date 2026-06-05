const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targetPath = path.join(root, 'ui/src/pages/RunOfShowPage.tsx');
const stagedPath = path.join(root, 'ui/src/_ros_utf8.txt');

let target = fs.readFileSync(targetPath, 'utf8');
const staged = fs.readFileSync(stagedPath, 'utf8').split(/\r?\n/);
const reconnectBlock = staged.slice(2747, 2977).join('\n');

target = target.replace(
  "import { useAuth } from '../contexts/AuthContext';",
  "import { useAuth } from '../contexts/OfflineAuthContext';"
);
target = target.replace(
  "} from '../lib/scheduleStartTime';\n\n// Speaker interface",
  `} from '../lib/scheduleStartTime';
import {
  clearRunOfShowReconnectHandlers,
  registerRunOfShowLocalFlush,
  registerRunOfShowSnapshotBuilder,
  isCloudReconnecting,
  type ReconnectSnapshot,
} from '../services/offline-sync-bridge';

function eventIdsMatch(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) === String(b);
}

// Speaker interface`
);
target = target.replace('  const openClock = () => {', '  const openTimerDisplay = () => {');
target = target.replace(
  "const clockUrl = event?.id ? `/clock?eventId=${event.id}` : '/clock';",
  "const clockUrl = event?.id ? `/timer?eventId=${encodeURIComponent(event.id)}` : '/timer';"
);
target = target.replace("      'clock',", "      'offlineShowTimer',");
target = target.replace('onSelectClock={openClock}', 'onSelectOfflineTimer={openTimerDisplay}');

const refBlock = `  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});
  /** Latest timer UI for cloud reconnect — refs avoid stale state when toggling Cloud on. */
  const reconnectTimerStateRef = useRef({
    hybridTimerData: { activeTimer: null as Record<string, unknown> | null },
    activeItemId: null as number | null,
    activeTimers: {} as Record<number, boolean>,
    loadedItems: {} as Record<number, boolean>,
    timerProgress: {} as Record<number, { elapsed: number; total: number; startedAt: Date | null }>,
    schedule: [] as typeof schedule,
    eventId: null as string | undefined,
    userId: null as string | undefined,
    userName: '',
    userRole: 'OPERATOR' as string,
  });`;
target = target.replace(
  '  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});',
  refBlock
);

target = target.replace(
  '  };\n\n  // Load master change log from API',
  `  };\n\n${reconnectBlock}\n\n  // Load master change log from API`
);

target = target.replace(
  `      onTimerUpdated: (data: any) => {
        console.log('📡 RunOfShow: Event ID check:', { received: data?.event_id, expected: event?.id, match: data?.event_id === event?.id });
        if (data && data.event_id === event?.id) {`,
  `      onTimerUpdated: (data: any) => {
        if (isCloudReconnecting()) {
          console.log('⏭️ Skipping timer WebSocket update during cloud reconnect');
          return;
        }
        console.log('📡 RunOfShow: Event ID check:', { received: data?.event_id, expected: event?.id, match: eventIdsMatch(data?.event_id, event?.id) });
        if (data && eventIdsMatch(data.event_id, event?.id)) {`
);

target = target.replace(
  `      onActiveTimersUpdated: (data: any) => {
        
        // Handle array format`,
  `      onActiveTimersUpdated: (data: any) => {
        if (isCloudReconnecting()) {
          console.log('⏭️ Skipping activeTimers WebSocket update during cloud reconnect');
          return;
        }

        // Handle array format`
);

target = target.replace(
  'if (timerData && timerData.event_id === event?.id)',
  'if (timerData && eventIdsMatch(timerData.event_id, event?.id))'
);
target = target.replace(
  'onSubCueTimerStarted: (data: any) => {\n        if (data && data.event_id === event?.id)',
  'onSubCueTimerStarted: (data: any) => {\n        if (data && eventIdsMatch(data.event_id, event?.id)'
);
target = target.replace(
  'onSubCueTimerStopped: (data: any) => {\n        if (data && data.event_id === event?.id)',
  'onSubCueTimerStopped: (data: any) => {\n        if (data && eventIdsMatch(data.event_id, event?.id)'
);

fs.writeFileSync(targetPath, target);
console.log('RunOfShow offline sync complete');
