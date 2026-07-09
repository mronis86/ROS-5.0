import React, { useState } from 'react';
import ReportIssueModal from './ReportIssueModal';

interface ReportIssueButtonProps {
  userEmail?: string;
  userName?: string;
  variant?: 'link' | 'footer';
  className?: string;
}

const ReportIssueButton: React.FC<ReportIssueButtonProps> = ({
  userEmail,
  userName,
  variant = 'link',
  className = '',
}) => {
  const [open, setOpen] = useState(false);

  const baseClass =
    variant === 'footer'
      ? 'text-xs font-medium text-slate-500 hover:text-slate-300'
      : 'text-xs font-medium text-slate-400 hover:text-slate-200 underline underline-offset-2';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${baseClass} ${className}`}
        title="Report an issue to administrators"
      >
        Report issue
      </button>
      <ReportIssueModal
        isOpen={open}
        onClose={() => setOpen(false)}
        userEmail={userEmail}
        userName={userName}
      />
    </>
  );
};

export default ReportIssueButton;
