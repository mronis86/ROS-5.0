import React, { useState, useEffect } from 'react';
import { driftDetector } from '../services/driftDetector';

const DriftDetectorTest: React.FC = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [itemId, setItemId] = useState(1);
  const [duration, setDuration] = useState(300); // 5 minutes
  const [elapsed, setElapsed] = useState(0);
  const [driftInfo, setDriftInfo] = useState<{ drift: number; timeSinceLastSync: number } | null>(null);

  useEffect(() => {
    const updateDriftInfo = () => {
      const status = driftDetector.getStatus();
      const itemStatus = status.find(s => s.itemId === itemId);
      if (itemStatus) {
        setDriftInfo({
          drift: itemStatus.drift,
          timeSinceLastSync: itemStatus.timeSinceLastSync
        });
      } else {
        setDriftInfo(null);
      }
    };

    const interval = setInterval(updateDriftInfo, 1000);
    return () => clearInterval(interval);
  }, [itemId]);

  const startMonitoring = () => {
    const startTime = new Date();
    setElapsed(0);
    setIsMonitoring(true);

    // Start drift detection
    driftDetector.startMonitoring(
      itemId,
      startTime,
      duration,
      (serverElapsed) => {
        console.log(`🔄 DriftDetector: Syncing with server elapsed: ${serverElapsed}s`);
        setElapsed(serverElapsed);
      }
    );

    // Simulate local timer
    const localTimer = setInterval(() => {
      setElapsed(prev => {
        const newElapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
        driftDetector.updateLocalElapsed(itemId, newElapsed);
        return newElapsed;
      });
    }, 100);
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    driftDetector.stopMonitoring(itemId);
  };

  const forceSync = async () => {
    await driftDetector.forceSync(itemId, async () => {
      // Simulate server response with slight drift
      const simulatedDrift = Math.random() * 2 - 1; // -1 to +1 seconds
      return Math.max(0, elapsed + simulatedDrift);
    });
  };

  const remaining = Math.max(0, duration - elapsed);
  const progress = (elapsed / duration) * 100;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Drift Detector Test</h2>
      
      <div className="space-y-4">
        <div className="flex gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Item ID:</label>
            <input
              type="number"
              value={itemId}
              onChange={(e) => setItemId(parseInt(e.target.value))}
              className="border rounded px-2 py-1"
              disabled={isMonitoring}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Duration (seconds):</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="border rounded px-2 py-1"
              disabled={isMonitoring}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={startMonitoring}
            disabled={isMonitoring}
            className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
          >
            Start Monitoring
          </button>
          <button
            onClick={stopMonitoring}
            disabled={!isMonitoring}
            className="bg-red-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
          >
            Stop Monitoring
          </button>
          <button
            onClick={forceSync}
            disabled={!isMonitoring}
            className="bg-green-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
          >
            Force Sync
          </button>
        </div>

        {isMonitoring && (
          <div className="space-y-4">
            <div className="bg-gray-100 p-4 rounded">
              <h3 className="font-semibold mb-2">Timer Status</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>Elapsed: {elapsed}s</div>
                <div>Remaining: {remaining}s</div>
                <div>Progress: {progress.toFixed(1)}%</div>
                <div>Duration: {duration}s</div>
              </div>
            </div>

            <div className="bg-gray-100 p-4 rounded">
              <h3 className="font-semibold mb-2">Drift Detection Status</h3>
              {driftInfo ? (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    Drift: <span className={driftInfo.drift > 2 ? 'text-red-600 font-bold' : 'text-green-600'}>
                      {driftInfo.drift.toFixed(2)}s
                    </span>
                  </div>
                  <div>
                    Last Sync: {Math.round(driftInfo.timeSinceLastSync / 1000)}s ago
                  </div>
                </div>
              ) : (
                <div className="text-gray-500">Not being monitored</div>
              )}
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-100"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        )}

        <div className="bg-gray-100 p-4 rounded">
          <h3 className="font-semibold mb-2">Configuration</h3>
          <div className="text-sm space-y-1">
            <div>Check Interval: {driftDetector.getConfig().checkInterval / 1000}s</div>
            <div>Max Drift Threshold: {driftDetector.getConfig().maxDriftThreshold}s</div>
            <div>Force Sync Interval: {driftDetector.getConfig().forceSyncInterval / 1000}s</div>
            <div>Min Timer Duration: {driftDetector.getConfig().minTimerDuration}s</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DriftDetectorTest;
