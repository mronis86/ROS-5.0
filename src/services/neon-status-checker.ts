// Neon Status Checker
// Monitors Neon database status and alerts users of outages

export interface NeonStatusInfo {
  isHealthy: boolean;
  region: string;
  message: string;
  lastChecked: Date;
}

class NeonStatusChecker {
  private checkInterval: NodeJS.Timeout | null = null;
  private lastStatus: NeonStatusInfo = {
    isHealthy: true,
    region: 'us-east-1',
    message: '',
    lastChecked: new Date()
  };
  private listeners: Array<(status: NeonStatusInfo) => void> = [];

  /**
   * Start monitoring Neon status
   * Checks every 60 seconds for issues
   */
  startMonitoring(callback: (status: NeonStatusInfo) => void) {
    // Add callback to listeners
    if (!this.listeners.includes(callback)) {
      this.listeners.push(callback);
    }

    // If already monitoring, don't start another interval
    if (this.checkInterval) {
      console.log('🔍 Neon status monitoring already running');
      // Send current status immediately
      callback(this.lastStatus);
      return;
    }

    console.log('🔍 Starting Neon status monitoring (checks every 60 seconds)');

    // Check immediately on start
    this.checkStatus();

    // Then check every 60 seconds
    this.checkInterval = setInterval(() => {
      this.checkStatus();
    }, 60000); // 60 seconds
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.listeners = [];
      console.log('🛑 Neon status monitoring stopped');
    }
  }

  /**
   * Check Neon database health
   * We check by making a simple query to the database
   */
  private async checkStatus() {
    try {
      // Try a simple database query to check connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || 'https://ros-50-production.up.railway.app'}/health`,
        { 
          signal: controller.signal,
          cache: 'no-store'
        }
      );

      clearTimeout(timeoutId);

      let isHealthy = response.ok;
      let message = '';
      
      // If response is OK, check the status field in the JSON
      if (response.ok) {
        try {
          const data = await response.json();
          isHealthy = data.status === 'healthy';
          
          if (data.status === 'degraded') {
            message = data.warnings?.join(', ') || 'Database tables are missing or inaccessible';
          } else if (data.status === 'unhealthy') {
            message = data.error || 'Database connectivity issues detected';
          }
        } catch (jsonError) {
          // JSON parsing failed, fall back to response.ok
          isHealthy = response.ok;
        }
      } else {
        message = 'Unable to connect to database server';
      }

      const newStatus: NeonStatusInfo = {
        isHealthy,
        region: 'us-east-1',
        message,
        lastChecked: new Date()
      };

      // Only notify listeners if status changed
      if (newStatus.isHealthy !== this.lastStatus.isHealthy) {
        console.log(`🔄 Neon status changed: ${newStatus.isHealthy ? 'Healthy' : 'Issues detected'}`);
        this.notifyListeners(newStatus);
      }

      this.lastStatus = newStatus;

    } catch (error) {
      // Connection failed - database likely has issues
      const newStatus: NeonStatusInfo = {
        isHealthy: false,
        region: 'us-east-1',
        message: 'Unable to connect to database. Please check your connection.',
        lastChecked: new Date()
      };

      if (newStatus.isHealthy !== this.lastStatus.isHealthy) {
        console.error('❌ Neon database health check failed:', error);
        this.notifyListeners(newStatus);
      }

      this.lastStatus = newStatus;
    }
  }

  /**
   * Notify all listeners of status change
   */
  private notifyListeners(status: NeonStatusInfo) {
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('❌ Error notifying status listener:', error);
      }
    });
  }

  /**
   * Get current status without checking
   */
  getCurrentStatus(): NeonStatusInfo {
    return { ...this.lastStatus };
  }
}

export const neonStatusChecker = new NeonStatusChecker();

