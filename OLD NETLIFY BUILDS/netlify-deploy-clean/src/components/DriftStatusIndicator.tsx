import React, { useState, useEffect } from 'react';
import { driftDetector } from '../services/driftDetector';

interface DriftStatusIndicatorProps {
  itemId: number;
  className?: string;
}

const DriftStatusIndicator: React.FC<DriftStatusIndicatorProps> = ({ itemId, className = '' }) => {
  const [driftInfo, setDriftInfo] = useState<{ drift: number; timeSinceLastSync: number } | null>(null);

  useEffect(() => {
    console.log(`🔄 DriftStatusIndicator: Starting for itemId ${itemId}`);
    
    const updateDriftInfo = () => {
      const itemStatus = driftDetector.getStatusForTimer(itemId);
      console.log(`🔄 DriftStatusIndicator: Status for itemId ${itemId}:`, itemStatus);
      if (itemStatus) {
        console.log(`🔄 DriftStatusIndicator: Found status for itemId ${itemId}:`, itemStatus);
        setDriftInfo({
          drift: itemStatus.drift,
          timeSinceLastSync: itemStatus.timeSinceLastSync
        });
      } else {
        console.log(`🔄 DriftStatusIndicator: No status found for itemId ${itemId}`);
        setDriftInfo(null);
      }
    };

    // Update immediately
    updateDriftInfo();

    // Update every 5 seconds
    const interval = setInterval(updateDriftInfo, 5000);

    return () => clearInterval(interval);
  }, [itemId]);

  if (!driftInfo) {
    // Show a blue dot if drift detection is starting up
    console.log(`🔄 DriftStatusIndicator: No drift info for itemId ${itemId}, showing blue dot (starting up)`);
    return (
      <div className={`drift-status ${className}`}>
        <div 
          className="w-2 h-2 rounded-full bg-blue-500"
          title={`Drift detection starting up for timer ${itemId}`}
        />
      </div>
    );
  }

  const { drift, timeSinceLastSync } = driftInfo;
  const isDriftHigh = drift > 30; // More than 30 seconds drift (very lenient for display pages)
  const isSyncOld = timeSinceLastSync > 60000; // More than 1 minute since last sync

  return (
    <div className={`drift-status ${className}`}>
      <div 
        className={`w-2 h-2 rounded-full ${
          isDriftHigh ? 'bg-red-500' : 
          isSyncOld ? 'bg-yellow-500' : 
          'bg-green-500'
        }`}
        title={`Drift: ${drift.toFixed(1)}s, Last sync: ${Math.round(timeSinceLastSync / 1000)}s ago`}
      />
    </div>
  );
};

export default DriftStatusIndicator;
