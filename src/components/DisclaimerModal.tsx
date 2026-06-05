import React from 'react';

const DISCLAIMER_SECTIONS = [
  {
    title: 'Web Application Disclaimer & Limitation of Liability',
    body: 'Last Updated: January 15, 2026',
    isIntro: true
  },
  {
    body: `By accessing and using SINOR Track (the "Service"), operated by SINOR Production Technology ("we," "us," or "our"), you accept and agree to be bound by the terms and provisions of this disclaimer. If you do not agree to abide by this disclaimer, you are not authorized to use or access the Service.`
  },
  {
    title: '1. "As-Is" and "As-Available" Basis',
    body: `The Service is provided to you strictly on an "AS IS" and "AS AVAILABLE" basis. We make no representations or warranties of any kind, express or implied, regarding the operation of the Service, its availability, or the information, content, materials, or products included within it. We do not warrant that the Service will be uninterrupted, error-free, completely secure, or free of viruses or other harmful components.`
  },
  {
    title: '2. Assumption of Risk regarding Data and Security',
    body: `By using this Service, you acknowledge and agree that the transmission of data over the internet is inherently not fully secure. While we strive to use commercially acceptable means to protect personal, proprietary, and commercial data, we cannot and do not guarantee the absolute security of any information you transmit to us or store on the Service. You use the Service entirely at your own risk.`
  },
  {
    title: '3. Data Loss and Corruption',
    body: `SINOR Production Technology shall not be held legally or financially responsible for any loss, corruption, alteration, or deletion of any data, files, or information uploaded, stored, or processed through the Service.

User Responsibility for Backups: It is your sole responsibility to maintain independent, external backups of any and all data you input into SINOR Track. We are under no obligation to retain or recover lost data.`
  },
  {
    title: '4. Data Breaches and Unauthorized Access',
    body: `In no event shall SINOR Production Technology be liable for any damages resulting from unauthorized access to, alteration of, or theft of your transmissions or data (a "Data Breach"). This includes, but is not limited to, breaches occurring as a result of hacking, server exploits, third-party vendor failures, credential theft, or any other acts of cybercrime, whether targeted at the Service directly or at our hosting providers.`
  },
  {
    title: '5. Limitation of Liability',
    body: `To the fullest extent permitted by applicable law, in no event shall SINOR Track, SINOR Production Technology, its developers, affiliates, or licensors be liable for any direct, indirect, incidental, special, consequential, or punitive damages. This includes, without limitation, damages for:

• Loss of profits, revenue, or goodwill;
• Loss of data, data breaches, or data corruption;
• Business interruption;
• Any other intangible losses;

resulting directly or indirectly from (i) your use or inability to use the Service; (ii) any unauthorized access to or use of our servers and/or any personal information stored therein; (iii) any temporary or permanent downtime of the Service.`
  },
  {
    title: '6. External Links and Third-Party Services',
    body: `The Service may contain links to or integrations with third-party web sites or services that are not owned or controlled by us. We have no control over, and assume no responsibility for, the content, privacy policies, security protocols, or practices of any third-party websites or services.`
  }
];

interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DisclaimerModal: React.FC<DisclaimerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-slate-600 bg-slate-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-700 px-6 py-4">
          <h2 id="disclaimer-title" className="text-xl font-bold text-white">
            Terms of Service & Disclaimer
          </h2>
          <p className="mt-1 text-sm text-slate-400">SINOR Track</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm leading-relaxed text-slate-300">
          {DISCLAIMER_SECTIONS.map((section, i) => (
            <div key={i} className={i > 0 ? 'mt-4' : ''}>
              {section.title && (
                <h3 className={`font-semibold text-white ${section.isIntro ? 'text-base' : 'text-sm'}`}>
                  {section.title}
                </h3>
              )}
              <p className={`whitespace-pre-line ${section.title && !section.isIntro ? 'mt-1.5' : section.isIntro ? 'mt-1 text-slate-400' : ''}`}>
                {section.body}
              </p>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-slate-700 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DisclaimerModal;
