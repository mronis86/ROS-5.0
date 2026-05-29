import React from 'react';
import { Outlet } from 'react-router-dom';
import OfflineAppHeader from './OfflineAppHeader';
import OfflineLayout from './OfflineLayout';

/** Event list, Run of Show, Quick mode — header + connectivity bar. */
const OfflineAppShell: React.FC = () => (
  <div className="App min-h-screen bg-slate-900">
    <OfflineAppHeader />
    <OfflineLayout>
      <Outlet />
    </OfflineLayout>
  </div>
);

export default OfflineAppShell;
