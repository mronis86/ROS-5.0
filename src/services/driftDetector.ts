/**
 * Drift Detector Service
 * 
 * This service monitors long-running timers and periodically syncs them with the server
 * to prevent drift that can accumulate over time (especially for 30+ minute timers).
 */

export interface DriftDetectionConfig {
  // How often to check for drift (in milliseconds)
  checkInterval: number;
  // Maximum allowed drift before forcing a sync (in seconds)
  maxDriftThreshold: number;
  // How often to force a sync regardless of drift (in milliseconds)
  forceSyncInterval: number;
  // Minimum timer duration to enable drift detection (in seconds)
  minTimerDuration: number;
}

export interface TimerState {
  itemId: number;
  startedAt: Date;
  duration: number;
  lastSyncAt: Date;
  localElapsed: number;
  serverElapsed: number;
}

export class DriftDetector {
  private config: DriftDetectionConfig;
  private activeTimers: Map<number, TimerState> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private syncCallbacks: Map<number, (serverElapsed: number) => void> = new Map();
  private isRunning = false;

  constructor(config?: Partial<DriftDetectionConfig>) {
    this.config = {
      checkInterval: 30000, // Check every 30 seconds (less aggressive)
      maxDriftThreshold: 30, // Max 30 seconds drift allowed (very lenient for display pages)
      forceSyncInterval: 30000, // Force sync every 30 seconds
      minTimerDuration: 0, // Start drift detection for all timers
      ...config
    };
  }

  /**
   * Start monitoring a timer for drift
   */
  startMonitoring(
    itemId: number,
    startedAt: Date,
    duration: number,
    onSync: (serverElapsed: number) => void
  ): void {
    console.log(`🔄 DriftDetector: Starting monitoring for timer ${itemId}`, {
      startedAt: startedAt.toISOString(),
      duration,
      minDuration: this.config.minTimerDuration
    });

    // Only monitor timers that are long enough to benefit from drift detection
    if (duration < this.config.minTimerDuration) {
      console.log(`⏭️ DriftDetector: Skipping timer ${itemId} - duration too short (${duration}s < ${this.config.minTimerDuration}s)`);
      return;
    }

    const timerState: TimerState = {
      itemId,
      startedAt,
      duration,
      lastSyncAt: new Date(),
      localElapsed: 0,
      serverElapsed: 0
    };

    this.activeTimers.set(itemId, timerState);
    this.syncCallbacks.set(itemId, onSync);

    // Start the monitoring loop if not already running
    if (!this.isRunning) {
      this.startMonitoringLoop();
    }
  }

  /**
   * Stop monitoring a timer
   */
  stopMonitoring(itemId: number): void {
    console.log(`🔄 DriftDetector: Stopping monitoring for timer ${itemId}`);
    this.activeTimers.delete(itemId);
    this.syncCallbacks.delete(itemId);

    // Stop monitoring loop if no active timers
    if (this.activeTimers.size === 0 && this.isRunning) {
      this.stopMonitoringLoop();
    }
  }

  /**
   * Update local elapsed time for a timer
   */
  updateLocalElapsed(itemId: number, localElapsed: number): void {
    const timerState = this.activeTimers.get(itemId);
    if (timerState) {
      timerState.localElapsed = localElapsed;
    }
  }

  /**
   * Force an immediate sync for a specific timer
   */
  async forceSync(itemId: number, getServerElapsed: () => Promise<number>): Promise<void> {
    const timerState = this.activeTimers.get(itemId);
    if (!timerState) return;

    try {
      const serverElapsed = await getServerElapsed();
      const drift = Math.abs(serverElapsed - timerState.localElapsed);
      
      console.log(`🔄 DriftDetector: Force sync for timer ${itemId}`, {
        localElapsed: timerState.localElapsed,
        serverElapsed,
        drift: drift.toFixed(2)
      });

      timerState.serverElapsed = serverElapsed;
      timerState.lastSyncAt = new Date();

      const callback = this.syncCallbacks.get(itemId);
      if (callback) {
        callback(serverElapsed);
      }
    } catch (error) {
      console.error(`❌ DriftDetector: Error during force sync for timer ${itemId}:`, error);
    }
  }

  /**
   * Start the monitoring loop
   */
  private startMonitoringLoop(): void {
    if (this.isRunning) return;

    console.log('🔄 DriftDetector: Starting monitoring loop');
    this.isRunning = true;

    this.checkInterval = setInterval(() => {
      this.checkAllTimers();
    }, this.config.checkInterval);
  }

  /**
   * Stop the monitoring loop
   */
  private stopMonitoringLoop(): void {
    if (!this.isRunning) return;

    console.log('🔄 DriftDetector: Stopping monitoring loop');
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check all active timers for drift
   */
  private async checkAllTimers(): Promise<void> {
    const now = new Date();
    const promises: Promise<void>[] = [];

    for (const [itemId, timerState] of this.activeTimers) {
      promises.push(this.checkTimerDrift(itemId, timerState, now));
    }

    await Promise.all(promises);
  }

  /**
   * Check a specific timer for drift
   */
  private async checkTimerDrift(itemId: number, timerState: TimerState, now: Date): Promise<void> {
    try {
      // Check if we need to force a sync based on time
      const timeSinceLastSync = now.getTime() - timerState.lastSyncAt.getTime();
      const shouldForceSync = timeSinceLastSync >= this.config.forceSyncInterval;

      if (shouldForceSync) {
        console.log(`🔄 DriftDetector: Force sync needed for timer ${itemId} (${timeSinceLastSync}ms since last sync)`);
        // Note: We can't call forceSync here because we don't have access to getServerElapsed
        // This will be handled by the calling code
        return;
      }

      // Calculate expected elapsed time
      const expectedElapsed = Math.floor((now.getTime() - timerState.startedAt.getTime()) / 1000);
      const drift = Math.abs(expectedElapsed - timerState.localElapsed);

      if (drift > this.config.maxDriftThreshold) {
        console.log(`⚠️ DriftDetector: Significant drift detected for timer ${itemId}`, {
          localElapsed: timerState.localElapsed,
          expectedElapsed,
          drift: drift.toFixed(2),
          threshold: this.config.maxDriftThreshold
        });
        // Note: We can't call forceSync here because we don't have access to getServerElapsed
        // This will be handled by the calling code
      }
    } catch (error) {
      console.error(`❌ DriftDetector: Error checking drift for timer ${itemId}:`, error);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): DriftDetectionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DriftDetectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('🔄 DriftDetector: Configuration updated', this.config);
  }

  /**
   * Get status of all monitored timers
   */
  getStatus(): { itemId: number; drift: number; timeSinceLastSync: number }[] {
    const now = new Date();
    return Array.from(this.activeTimers.entries()).map(([itemId, timerState]) => {
      const drift = Math.abs(timerState.serverElapsed - timerState.localElapsed);
      const timeSinceLastSync = now.getTime() - timerState.lastSyncAt.getTime();
      return { itemId, drift, timeSinceLastSync };
    });
  }

  /**
   * Get status for a specific timer (even if not actively monitored on this browser)
   */
  getStatusForTimer(itemId: number): { itemId: number; drift: number; timeSinceLastSync: number } | null {
    const timerState = this.activeTimers.get(itemId);
    if (!timerState) {
      // Return a default status for timers not monitored on this browser
      return {
        itemId,
        drift: 0,
        timeSinceLastSync: 0
      };
    }
    
    const now = new Date();
    const drift = Math.abs(timerState.serverElapsed - timerState.localElapsed);
    const timeSinceLastSync = now.getTime() - timerState.lastSyncAt.getTime();
    
    return { itemId, drift, timeSinceLastSync };
  }

  /**
   * Cleanup and stop all monitoring
   */
  destroy(): void {
    console.log('🔄 DriftDetector: Destroying drift detector');
    this.stopMonitoringLoop();
    this.activeTimers.clear();
    this.syncCallbacks.clear();
  }
}

// Singleton instance
export const driftDetector = new DriftDetector();
