import React, { useState, useMemo } from 'react';

interface HelpSection {
  id: string;
  title: string;
  keywords: string[];
  content: React.ReactNode;
}

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const sections: HelpSection[] = useMemo(
    () => [
      {
        id: 'time-control',
        title: 'Event Days and Start Times',
        keywords: ['timer', 'duration', 'start', 'stop', 'reset', 'countdown', 'sync', 'adjust', '+1', '-1', '+5', '-5', 'master time', 'master start time', 'day start time', 'multiday', 'day selector', 'day dropdown', 'event days', 'start times'],
        content: (
          <div className="space-y-4 text-base text-slate-300 max-w-full">
            <h4 className="font-semibold text-white">Master Time / Show Start Time</h4>
            <p className="leading-relaxed break-words">
              The <strong className="text-white">Master Start Time</strong> is the time the show begins. It drives all the <strong className="text-white">Start</strong> column times in your schedule. Each row&apos;s start time is calculated from this base time plus the duration of previous items.
            </p>

            {/* UI screenshot with highlighted Start Time */}
            <div>
              <p className="text-slate-400 text-sm mb-2">Click the highlighted area to set the show start time:</p>
              <div className="rounded overflow-hidden border border-slate-600 w-full">
                <img
                  src="/help/start-time-master-time.png"
                  alt="Run of Show header - Start Time field highlighted"
                  className="block w-full min-w-[750px] max-w-full"
                />
              </div>
            </div>

            <p className="leading-relaxed break-words">
              <strong className="text-white">Where to set it:</strong> In the header bar (see image above), the <strong className="text-white">Start Time</strong> input shows the current time (e.g. 08:50 AM). Click it to change. Only EDITORs can change it (VIEWERs and OPERATORs see it disabled).
            </p>

            {/* Day image floats right at Multiday line - text wraps around */}
            <div className="overflow-hidden">
              <div className="float-right ml-4 mb-2 rounded overflow-hidden border border-slate-600 shrink-0">
                <img
                  src="/help/day-selector-multiday.png"
                  alt="Day selector dropdown for multiday events"
                  className="block w-auto max-w-[280px]"
                />
              </div>
              <p className="leading-relaxed break-words">
                <strong className="text-white">Multiday events:</strong> If your event has more than one day, you must set a start time <strong className="text-white">for each day</strong>. Each day has its own start time.
              </p>
              <h4 className="font-semibold text-white mt-3 mb-1">Selecting the Day (Multiday Events)</h4>
              <p className="leading-relaxed">
                Use the <strong className="text-white">Day</strong> dropdown to switch between Day 1, Day 2, etc. Select the day you want to edit, then set the Start Time for that day. The Start Time input shows and updates the start time for the selected day.
              </p>
            </div>
          </div>
        )
      },
      {
        id: 'row-items-columns',
        title: 'Row Items & Columns',
        keywords: ['row', 'column', 'cue', 'schedule', 'program type', 'segment', 'notes', 'speakers', 'assets', 'filter', 'custom', 'add item', '+ item', '+ column'],
        content: (
          <div className="space-y-4 text-base text-slate-300">
            <p><strong className="text-white">Schedule Rows:</strong> Each row is a cue item with a cue number, program type, segment name, duration, and optional notes, speakers, and assets.</p>

            {/* Add Item image */}
            <div>
              <p className="text-slate-400 text-sm mb-2">Use the + Item and + Column buttons below the Schedule header:</p>
              <div className="rounded overflow-hidden border border-slate-600 w-full">
                <img
                  src="/help/row-column-add-item.png"
                  alt="Schedule header with + Item and + Column buttons"
                  className="block w-full min-w-[400px] max-w-full"
                />
              </div>
            </div>

            <h4 className="font-semibold text-white">Step-by-step: Adding a new item</h4>
            <ol className="list-decimal list-inside space-y-2 leading-relaxed">
              <li><strong className="text-white">Click the blue + Item button</strong> below the Schedule header (shown above).</li>
              <li>The <strong className="text-white">Add Schedule Item</strong> modal opens. Fill in the fields:
                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                  <li><strong className="text-white">Cue</strong> — e.g. 1, 1.1, 1A</li>
                  <li><strong className="text-white">Program Type</strong> — Main Cue, Sub Cue, Breakout Session, etc.</li>
                  <li><strong className="text-white">Segment Name</strong> — Name of the segment</li>
                  <li><strong className="text-white">Shot Type</strong> — Optional</li>
                  <li><strong className="text-white">Duration</strong> — Hours, minutes, seconds (H:M:S)</li>
                  <li><strong className="text-white">Has PPT</strong> / <strong className="text-white">Has QA</strong> — Optional checkboxes</li>
                  <li><strong className="text-white">Notes</strong>, <strong className="text-white">Assets</strong>, <strong className="text-white">Speakers</strong> — Click to open editors for rich content</li>
                </ul>
              </li>
              <li>Click <strong className="text-white">Add Item</strong> to save. The new row appears in the schedule.</li>
            </ol>

            <p><strong className="text-white">Editing in the row:</strong> You can also click any cell in an existing row to edit inline. Notes, Speakers, and Assets open in modals when clicked.</p>

            <h4 className="font-semibold text-white">Adding columns</h4>
            <p>Click the green <strong className="text-white">+ Column</strong> button to add a custom column. Use Filter View to show or hide columns (Start Time, Duration, Notes, Speakers, Assets, etc.).</p>
          </div>
        )
      },
      {
        id: 'breakouts',
        title: 'Breakouts',
        keywords: ['breakout', 'breakout session', 'breakout room', 'room', 'session', 'row menu', '# button'],
        content: (
          <div className="space-y-6 text-base text-slate-300 overflow-hidden">
            <p><strong className="text-white">Breakout Sessions:</strong> When adding an item, select &quot;Breakout Session&quot; as the program type. You can set segment name and shot type for the breakout.</p>

            <div className="overflow-hidden">
              <h4 className="font-semibold text-white mb-2">Adding Breakout Rooms</h4>
<div className="float-right ml-2 mb-3 -mt-8 rounded overflow-hidden border border-slate-600 shrink-0">
              <img
                src="/help/breakout-row-menu.png"
                alt="Row context menu with Add Breakout Room option"
                className="block w-auto max-w-[360px]"
              />
              </div>
              <p>To add breakout rooms to a Breakout Session row:</p>
              <ol className="list-decimal list-inside space-y-2 leading-relaxed">
                <li>Click the purple row menu button <span className="inline-flex items-center justify-center w-7 h-7 bg-purple-600 text-white text-sm font-bold rounded mx-0.5">#</span> on the left of the row.</li>
                <li>In the context menu (see image), select <strong className="text-white">Add Breakout Room</strong>.</li>
              </ol>
            </div>

            <div className="clear-both pt-1 overflow-hidden">
              <div className="float-left mr-4 mb-3 -mt-14 rounded overflow-hidden border border-slate-600 shrink-0">
                <img
                  src="/help/breakout-add-rooms-modal.png"
                  alt="Add Breakout Rooms modal"
                  className="block w-auto max-w-[220px]"
                />
              </div>
              <p><strong className="text-white">Add Breakout Rooms modal:</strong> Set <strong className="text-white">Number of Breakout Rooms</strong>, then for each room choose <strong className="text-white">Location</strong> (e.g. Great Hall) and <strong className="text-white">Breakout Title</strong> (e.g. Session A, Track 1). Each room is added as &quot;Location - Breakout Title&quot; and appears as a sub-indented cue under the Breakout Session with no start time.</p>
              <p>When you&apos;re done filling in the room details, click <strong className="text-white">Add 1 Room</strong> (or Add N Rooms) to create the rooms and add them to the schedule. The button label reflects how many rooms you chose.</p>
            </div>
          </div>
        )
      },
      {
        id: 'roles-permissions',
        title: 'Roles & Permissions',
        keywords: ['role', 'operator', 'editor', 'viewer', 'permission'],
        content: (
          <div className="space-y-3 text-base text-slate-300">
            <p><strong className="text-white">OPERATOR:</strong> Full control — timer adjustments, messages, duration changes, and all editing.</p>
            <p><strong className="text-white">EDITOR:</strong> Can edit schedule content (notes, speakers, assets) but cannot adjust timer or send messages.</p>
            <p><strong className="text-white">VIEWER:</strong> Read-only. Can view schedule and timers but cannot edit or control.</p>
            <p><strong className="text-white">Change Role:</strong> Use the Change Role button in the control panel to switch roles.</p>
          </div>
        )
      },
      {
        id: 'osc-control',
        title: 'OSC Control',
        keywords: ['osc', 'cue', 'load', 'timer', 'subtimer', 'commands'],
        content: (
          <div className="space-y-3 text-base text-slate-300">
            <p><strong className="text-white">Cue Commands:</strong> <code className="bg-slate-700 px-1 rounded">/cue/1/load</code>, <code className="bg-slate-700 px-1 rounded">/cue/1.1/load</code>. Day-aware for multi-day shows.</p>
            <p><strong className="text-white">Timer:</strong> <code className="bg-slate-700 px-1 rounded">/timer/start</code>, <code className="bg-slate-700 px-1 rounded">/timer/stop</code>, <code className="bg-slate-700 px-1 rounded">/timer/reset</code></p>
            <p><strong className="text-white">Sub-Timers:</strong> <code className="bg-slate-700 px-1 rounded">/subtimer/cue/5/start</code>, <code className="bg-slate-700 px-1 rounded">/subtimer/cue/5/stop</code></p>
            <p><strong className="text-white">Download OSC Apps:</strong> Open the OSC Control panel from the toolbar to download portable and desktop OSC apps.</p>
          </div>
        )
      },
      {
        id: 'backup-restore',
        title: 'Backup & Restore',
        keywords: ['backup', 'restore', 'create backup', 'manual'],
        content: (
          <div className="space-y-3 text-base text-slate-300">
            <p><strong className="text-white">Create Backup:</strong> Use the Create Backup button to save a manual snapshot of the current event data.</p>
            <p><strong className="text-white">Auto-Backups:</strong> The system can create automatic backups at intervals.</p>
            <p><strong className="text-white">Restore:</strong> Open the Backup modal from the menu to view backups and restore a previous version.</p>
          </div>
        )
      }
    ],
    []
  );

  const filteredSections = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [sections, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg w-full max-w-6xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-600">
          <h2 className="text-lg font-bold text-white">Help & Tool Tips</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-600">
          <input
            type="text"
            placeholder="Search help..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredSections.length === 0 ? (
            <p className="text-slate-400 text-sm py-4">No results found for &quot;{searchQuery}&quot;</p>
          ) : (
            filteredSections.map((section) => (
              <div
                key={section.id}
                className="bg-slate-700 rounded-lg overflow-hidden"
              >
                <button
                  onClick={() =>
                    setExpandedSection((prev) =>
                      prev === section.id ? null : section.id
                    )
                  }
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-600 transition-colors"
                >
                  <span className="font-bold text-lg text-white">{section.title}</span>
                  <span className="text-slate-400 text-lg">
                    {expandedSection === section.id ? '−' : '+'}
                  </span>
                </button>
                {expandedSection === section.id && (
                  <div className="px-4 pb-4 pt-4 border-t-2 border-slate-500">
                    {section.content}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default HelpModal;
