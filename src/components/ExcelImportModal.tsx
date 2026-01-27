import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';

interface ParsedRow {
  row: number;
  cue: string;
  segmentName: string;
  duration: string;
  shotType: string;
  hasPPT: boolean;
  hasQA: boolean;
  programType: string;
  notes: string;
  assets: string;
  speakers: string;
}

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: any[]) => void;
  onDeleteAll: () => void;
}

/** Normalize for alias lookup: lowercase, collapse spaces/hyphens. */
const normalizeShotTypeForAlias = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/-/g, '').replace(/\s/g, '').toLowerCase().trim();

/** Exact alias -> canonical Shot Type. */
const SHOT_TYPE_ALIASES = (() => {
  const canonical = ['Podium', '2-Shot', '3-Shot', '4-Shot', '5-Shot', '6-Shot', '7-Shot', 'Ted-Talk'] as const;
  const aliasList: [string, string][] = [
    ['pod', 'Podium'],
    ['p', 'Podium'],
    ['2sh', '2-Shot'],
    ['twoshot', '2-Shot'],
    ['3sh', '3-Shot'],
    ['threeshot', '3-Shot'],
    ['4sh', '4-Shot'],
    ['fourshot', '4-Shot'],
    ['5sh', '5-Shot'],
    ['fiveshot', '5-Shot'],
    ['6sh', '6-Shot'],
    ['sixshot', '6-Shot'],
    ['7sh', '7-Shot'],
    ['sevenshot', '7-Shot'],
    ['ted', 'Ted-Talk'],
    ['tedtalk', 'Ted-Talk'],
  ];
  const m = new Map<string, string>();
  for (const c of canonical) m.set(normalizeShotTypeForAlias(c), c);
  for (const [alias, can] of aliasList) m.set(normalizeShotTypeForAlias(alias), can);
  return m;
})();

/** Pattern-based: e.g. "2 shot lav", "2shot lavalier", "3shot" -> N-Shot. Number alone is not matched. */
const SHOT_TYPE_PATTERNS: { pattern: RegExp; canonical: string }[] = [
  { pattern: /^2(shot|sh|lav|lavalier)/, canonical: '2-Shot' },
  { pattern: /^twoshot/, canonical: '2-Shot' },
  { pattern: /^two(shot|sh|lav|lavalier)/, canonical: '2-Shot' },
  { pattern: /^3(shot|sh|lav|lavalier)/, canonical: '3-Shot' },
  { pattern: /^threeshot/, canonical: '3-Shot' },
  { pattern: /^three(shot|sh|lav|lavalier)/, canonical: '3-Shot' },
  { pattern: /^4(shot|sh|lav|lavalier)/, canonical: '4-Shot' },
  { pattern: /^fourshot/, canonical: '4-Shot' },
  { pattern: /^four(shot|sh|lav|lavalier)/, canonical: '4-Shot' },
  { pattern: /^5(shot|sh|lav|lavalier)/, canonical: '5-Shot' },
  { pattern: /^fiveshot/, canonical: '5-Shot' },
  { pattern: /^five(shot|sh|lav|lavalier)/, canonical: '5-Shot' },
  { pattern: /^6(shot|sh|lav|lavalier)/, canonical: '6-Shot' },
  { pattern: /^sixshot/, canonical: '6-Shot' },
  { pattern: /^six(shot|sh|lav|lavalier)/, canonical: '6-Shot' },
  { pattern: /^7(shot|sh|lav|lavalier)/, canonical: '7-Shot' },
  { pattern: /^sevenshot/, canonical: '7-Shot' },
  { pattern: /^seven(shot|sh|lav|lavalier)/, canonical: '7-Shot' },
];

const ExcelImportModal: React.FC<ExcelImportModalProps> = ({ isOpen, onClose, onImport, onDeleteAll }) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setParsedData([]);
      setSheets([]);
      setSelectedSheet('');
    }
  };

  const convertExcelTimeToHHMMSS = (decimalTime: number): string => {
    const totalSeconds = Math.round(decimalTime * 24 * 60 * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  /** Map shorthand/variants (e.g. POD, 2shot, 2 shot lav) to canonical Shot Type. */
  const resolveShotTypeAlias = (raw: string): string | null => {
    if (!raw || typeof raw !== 'string') return null;
    const n = normalizeShotTypeForAlias(raw);
    if (!n) return null;
    const exact = SHOT_TYPE_ALIASES.get(n);
    if (exact) return exact;
    for (const { pattern, canonical } of SHOT_TYPE_PATTERNS) {
      if (pattern.test(n)) return canonical;
    }
    return null;
  };

  const parseShotTypeAndFlags = (value: string) => {
    const text = value.toString().toLowerCase();
    let shotType = value;
    let hasPPT = false;
    let hasQA = false;
    
    if (text.includes('ppt') || text.includes('powerpoint')) {
      hasPPT = true;
      shotType = shotType.replace(/\+?\s*ppt\s*\+?/gi, '').replace(/\+?\s*powerpoint\s*\+?/gi, '');
    }
    
    if (text.includes('q&a') || text.includes('qa')) {
      hasQA = true;
      shotType = shotType.replace(/\+?\s*q&a\s*\+?/gi, '').replace(/\s*\+\s*qa\s*\+?/gi, '');
    }
    
    shotType = shotType.replace(/^\++|\++$/g, '').replace(/\s*\+\s*/g, ' ').trim();
    const resolved = resolveShotTypeAlias(shotType);
    if (resolved) shotType = resolved;
    
    return { shotType, hasPPT, hasQA };
  };

  const parseIndividualSpeaker = (speakerText: string, slotNumber: number) => {
    if (!speakerText.trim()) return null;
    
    // Handle different line break formats (Windows \r\n, Unix \n, Mac \r)
    // Also handle cases where Excel might use different separators
    const lines = speakerText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (lines.length >= 2) {
      let name = lines[0];
      let location = 'Seat';
      
      // Handle location prefixes
      if (name.startsWith('*P*')) {
        location = 'Podium';
        name = name.replace('*P*', '').trim();
      } else if (name.startsWith('*M*')) {
        location = 'Moderator';
        name = name.replace('*M*', '').trim();
      } else if (name.startsWith('*V*')) {
        location = 'Virtual';
        name = name.replace('*V*', '').trim();
      }
      
      const title = lines[1];
      let photoUrl = '';
      let org = '';
      
      // Look for photo URL from the end backwards
      for (let j = lines.length - 1; j >= 2; j--) {
        const lineText = lines[j];
        
        if (lineText) {
          // Check for various URL patterns
          const urlPatterns = [
            /^https?:\/\/.+/i,           // http:// or https://
            /^www\..+/i,                 // www.domain.com
            /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i,  // domain.com or subdomain.domain.com
            /^\/.+\.(jpg|jpeg|png|gif|webp)$/i, // relative paths with image extensions
            /^.+\/(.+)\.(jpg|jpeg|png|gif|webp)$/i // paths ending with image extensions
          ];
          
          const isUrl = urlPatterns.some(pattern => pattern.test(lineText));
          
          if (isUrl) {
            // Normalize the URL
            let normalizedUrl = lineText.trim();
            if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
              if (normalizedUrl.startsWith('www.')) {
                normalizedUrl = 'https://' + normalizedUrl;
              } else if (normalizedUrl.includes('.') && !normalizedUrl.startsWith('/')) {
                normalizedUrl = 'https://' + normalizedUrl;
              }
            }
            
            photoUrl = normalizedUrl;
            
            // If there's a line before the photo URL, it's likely the org
            if (j > 2 && lines[j-1]) {
              org = lines[j-1];
            }
            break;
          }
        }
      }
      
      // If no photo URL found, check if there are additional lines for org
      if (!photoUrl && lines.length > 2) {
        // Check if any remaining lines might be URLs that were missed
        for (let k = 2; k < lines.length; k++) {
          const remainingLine = lines[k];
          
          // Check if this line might be a URL (even if it doesn't match our patterns exactly)
          if (remainingLine && (
            remainingLine.includes('.jpg') || 
            remainingLine.includes('.jpeg') || 
            remainingLine.includes('.png') || 
            remainingLine.includes('.gif') || 
            remainingLine.includes('.webp') ||
            remainingLine.includes('http') ||
            remainingLine.includes('www.') ||
            (remainingLine.includes('.') && remainingLine.length > 10)
          )) {
            // Try to clean it up
            let potentialUrl = remainingLine.trim();
            if (!potentialUrl.startsWith('http://') && !potentialUrl.startsWith('https://')) {
              if (potentialUrl.startsWith('www.')) {
                potentialUrl = 'https://' + potentialUrl;
              } else if (potentialUrl.includes('.') && !potentialUrl.startsWith('/')) {
                potentialUrl = 'https://' + potentialUrl;
              }
            }
            photoUrl = potentialUrl;
            break;
          }
        }
        
        // If still no photo URL found, set org
        if (!photoUrl) {
          // If we have exactly 3 lines, the third is likely org
          if (lines.length === 3) {
            org = lines[2];
          } else if (lines.length > 3) {
            // If we have more than 3 lines and no URL, org might be line 2
            org = lines[2];
          }
        }
      }
      
      const result = {
        id: `speaker-${slotNumber}`,
        slot: slotNumber,
        location: location,
        fullName: name,
        title: title,
        org: org,
        photoUrl: photoUrl
      };
      
      return result;
    }
    
    return null;
  };

  const handleParse = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      
      // Get all sheet names
      const sheetNames = workbook.SheetNames;
      setSheets(sheetNames);
      
      // If multiple sheets, let user select one
      if (sheetNames.length > 1) {
        setSelectedSheet(sheetNames[0]); // Default to first sheet
        setParsedData([]); // Clear any previous data
        return; // Don't parse yet, wait for user to select sheet
      }
      
      // Single sheet - proceed with parsing
      const sheetName = sheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 12) {
        throw new Error('Excel file must have at least 12 rows. Headers should be in row 11, data should start from row 12.');
      }

      const headers = jsonData[10] as string[];
      if (!headers || headers.length === 0) {
        throw new Error('No headers found in row 11. Please ensure headers are in row 11.');
      }

      const parsedRows: ParsedRow[] = [];

      // Helper function to get cell value with preserved newlines
      const getCellValue = (rowIndex: number, colIndex: number): string => {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = worksheet[cellAddress];
        if (!cell) return '';
        
        let value = '';
        
        // Try to get the formatted text value first (preserves newlines)
        if (cell.w !== undefined) {
          // w is the formatted text value which preserves newlines
          value = cell.w;
        } else if (cell.v !== undefined) {
          // v is the raw value - convert to string
          value = String(cell.v);
        }
        
        if (!value) return '';
        
        // Normalize line breaks: convert \r\n (Windows) and \r (Mac) to \n (Unix)
        // This ensures consistent line breaks regardless of Excel's format
        value = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        return value;
      };

      for (let i = 11; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0) continue;

        const parsedRow: ParsedRow = {
          row: i - 10,
          cue: '',
          segmentName: '',
          duration: '',
          shotType: '',
          hasPPT: false,
          hasQA: false,
          programType: '',
          notes: '',
          assets: '',
          speakers: ''
        };

        // Column A (index 0) = CUE
        if (row[0]) parsedRow.cue = row[0].toString();
        
        // Column C (index 2) = Program Type
        if (row[2]) {
          let programType = row[2].toString();
          if (programType.toLowerCase() === 'pod transition') {
            programType = 'Podium Transition';
          }
          // Map "Break" to "Break F&B/B2B" for compatibility
          if (programType.toLowerCase() === 'break') {
            programType = 'Break F&B/B2B';
          }
          // Map "Breakout Session" if explicitly specified
          if (programType.toLowerCase() === 'breakout session' || programType.toLowerCase() === 'breakout') {
            programType = 'Breakout Session';
          }
          parsedRow.programType = programType;
        }
        
        // Column D (index 3) = Duration
        if (row[3]) {
          const durationValue = row[3];
          if (typeof durationValue === 'number' && durationValue < 1) {
            parsedRow.duration = convertExcelTimeToHHMMSS(durationValue);
          } else {
            parsedRow.duration = durationValue.toString();
          }
        }
        
        // Column J (index 9) = Segment Name
        if (row[9]) parsedRow.segmentName = row[9].toString();
        
        // Column K (index 10) = Shot Type + PPT & QA
        if (row[10]) {
          const shotTypeValue = row[10].toString();
          const { shotType, hasPPT, hasQA } = parseShotTypeAndFlags(shotTypeValue);
          parsedRow.shotType = shotType;
          parsedRow.hasPPT = hasPPT;
          parsedRow.hasQA = hasQA;
        }
        
        // Column L (index 11) = Notes - preserve line breaks by accessing cell directly
        const notesValue = getCellValue(i, 11);
        if (notesValue) parsedRow.notes = notesValue;
        
        // Column N (index 13) = Assets
        if (row[13]) {
          parsedRow.assets = row[13].toString();
        }
        
        // Columns V-AB (indexes 21-27) = Speakers
        const speakersData = [];
        for (let speakerIndex = 21; speakerIndex <= 27; speakerIndex++) {
          if (row[speakerIndex]) {
            const speakerText = row[speakerIndex].toString().trim();
            // Only process if there's actual content (not just whitespace or empty)
            if (speakerText && speakerText.length > 0 && speakerText !== '') {
              const slotNumber = speakerIndex - 20;
              const parsedSpeaker = parseIndividualSpeaker(speakerText, slotNumber);
              if (parsedSpeaker && parsedSpeaker.fullName && parsedSpeaker.fullName.trim() !== '') {
                speakersData.push(parsedSpeaker);
              }
            }
          }
        }
        if (speakersData.length > 0) {
          parsedRow.speakers = JSON.stringify(speakersData);
        }

        parsedRows.push(parsedRow);
      }

      setParsedData(parsedRows);
      console.log('✅ Excel parsing completed:', parsedRows.length, 'rows');

    } catch (err) {
      console.error('❌ Error parsing Excel:', err);
      setError(err instanceof Error ? err.message : 'Failed to parse Excel file');
    } finally {
      setIsProcessing(false);
    }
  };

  const parseSelectedSheet = async () => {
    if (!file || !selectedSheet) return;

    setIsProcessing(true);
    setError(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[selectedSheet];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 12) {
        throw new Error('Excel file must have at least 12 rows. Headers should be in row 11, data should start from row 12.');
      }

      const headers = jsonData[10] as string[];
      if (!headers || headers.length === 0) {
        throw new Error('No headers found in row 11. Please ensure headers are in row 11.');
      }

      const parsedRows: ParsedRow[] = [];

      // Helper function to get cell value with preserved newlines
      const getCellValue = (rowIndex: number, colIndex: number): string => {
        const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = worksheet[cellAddress];
        if (!cell) return '';
        
        let value = '';
        
        // Try to get the formatted text value first (preserves newlines)
        if (cell.w !== undefined) {
          // w is the formatted text value which preserves newlines
          value = cell.w;
        } else if (cell.v !== undefined) {
          // v is the raw value - convert to string
          value = String(cell.v);
        }
        
        if (!value) return '';
        
        // Normalize line breaks: convert \r\n (Windows) and \r (Mac) to \n (Unix)
        // This ensures consistent line breaks regardless of Excel's format
        value = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        return value;
      };

      for (let i = 11; i < jsonData.length; i++) {
        const row = jsonData[i] as any[];
        if (!row || row.length === 0) continue;

        const parsedRow: ParsedRow = {
          row: i - 10,
          cue: '',
          segmentName: '',
          duration: '',
          shotType: '',
          hasPPT: false,
          hasQA: false,
          programType: '',
          notes: '',
          assets: '',
          speakers: ''
        };

        // Column A (index 0) = CUE
        if (row[0]) parsedRow.cue = row[0].toString();
        
        // Column C (index 2) = Program Type
        if (row[2]) {
          let programType = row[2].toString();
          if (programType.toLowerCase() === 'pod transition') {
            programType = 'Podium Transition';
          }
          // Map "Break" to "Break F&B/B2B" for compatibility
          if (programType.toLowerCase() === 'break') {
            programType = 'Break F&B/B2B';
          }
          // Map "Breakout Session" if explicitly specified
          if (programType.toLowerCase() === 'breakout session' || programType.toLowerCase() === 'breakout') {
            programType = 'Breakout Session';
          }
          parsedRow.programType = programType;
        }
        
        // Column D (index 3) = Duration
        if (row[3]) {
          const durationValue = row[3];
          if (typeof durationValue === 'number' && durationValue < 1) {
            parsedRow.duration = convertExcelTimeToHHMMSS(durationValue);
          } else {
            parsedRow.duration = durationValue.toString();
          }
        }
        
        // Column J (index 9) = Segment Name
        if (row[9]) parsedRow.segmentName = row[9].toString();
        
        // Column K (index 10) = Shot Type + PPT & QA
        if (row[10]) {
          const shotTypeValue = row[10].toString();
          const { shotType, hasPPT, hasQA } = parseShotTypeAndFlags(shotTypeValue);
          parsedRow.shotType = shotType;
          parsedRow.hasPPT = hasPPT;
          parsedRow.hasQA = hasQA;
        }
        
        // Column L (index 11) = Notes - preserve line breaks by accessing cell directly
        const notesValue = getCellValue(i, 11);
        if (notesValue) parsedRow.notes = notesValue;
        
        // Column N (index 13) = Assets
        if (row[13]) {
          parsedRow.assets = row[13].toString();
        }
        
        // Columns V-AB (indexes 21-27) = Speakers
        const speakersData = [];
        for (let speakerIndex = 21; speakerIndex <= 27; speakerIndex++) {
          if (row[speakerIndex]) {
            const speakerText = row[speakerIndex].toString().trim();
            // Only process if there's actual content (not just whitespace or empty)
            if (speakerText && speakerText.length > 0 && speakerText !== '') {
              const slotNumber = speakerIndex - 20;
              const parsedSpeaker = parseIndividualSpeaker(speakerText, slotNumber);
              if (parsedSpeaker && parsedSpeaker.fullName && parsedSpeaker.fullName.trim() !== '') {
                speakersData.push(parsedSpeaker);
              }
            }
          }
        }
        if (speakersData.length > 0) {
          parsedRow.speakers = JSON.stringify(speakersData);
        }

        parsedRows.push(parsedRow);
      }

      setParsedData(parsedRows);
      console.log('✅ Excel parsing completed:', parsedRows.length, 'rows');

    } catch (err) {
      console.error('❌ Error parsing Excel:', err);
      setError(err instanceof Error ? err.message : 'Failed to parse Excel file');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = () => {
    if (parsedData.length === 0) return;
    onImport(parsedData);
    onClose();
  };

  const handleDeleteAll = () => {
    if (window.confirm('Are you sure you want to delete ALL existing schedule items? This action cannot be undone.')) {
      onDeleteAll();
    }
  };

  const handleClose = () => {
    setFile(null);
    setParsedData([]);
    setError(null);
    setSheets([]);
    setSelectedSheet('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col shadow-xl">
        <header className="shrink-0 flex justify-between items-center p-6 pb-0">
          <h2 className="text-xl font-bold text-white">Import Excel File</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
        <div className="space-y-4">
          {/* Delete All Button - Only show before parsing */}
          {parsedData.length === 0 && (
            <div className="bg-red-900/20 border border-red-600 rounded-md p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-red-400 font-semibold mb-1">Clear Existing Data</h3>
                  <p className="text-gray-300 text-sm">Delete all existing schedule items before importing new data</p>
                </div>
                <button
                  onClick={handleDeleteAll}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md transition-colors"
                >
                  Delete All Rows
                </button>
              </div>
            </div>
          )}

          {/* Instructions - Hide after first parse (open workbook) to save room */}
          {parsedData.length === 0 && sheets.length <= 1 && (
            <div className="bg-slate-700 p-4 rounded-md">
              <h3 className="text-white font-semibold mb-2">Excel File Format Requirements:</h3>
              <ul className="text-gray-300 text-sm space-y-1">
                <li>• Headers should be in row 11, data should start from row 12</li>
                <li>• Expected columns: A=CUE, C=Program Type, D=Duration, J=Segment Name, K=Shot Type+PPT+QA, L=Notes, N=Assets, V-AB=Speakers</li>
                <li>• Shot Type (K): Use Podium, 2-Shot … 7-Shot, Ted-Talk. Shorthand OK: POD, 2shot, 2 shot, 2 shot lav, 2shot lavalier, 3shot, etc.</li>
                <li>• "Pod Transition" will be converted to "Podium Transition"</li>
                <li>• Excel decimal time format (0.002083...) will be converted to HH:MM:SS</li>
                <li>• Speaker format: Name, Title, [Org], Photo URL (with line breaks). Use *P* (Podium), *M* (Moderator), *V* (Virtual) prefixes</li>
              </ul>
            </div>
          )}

          {/* File Selection - Hide after parsing */}
          {parsedData.length === 0 && (
            <div>
              <label className="block text-white text-sm font-medium mb-2">
                Select Excel File (.xlsx, .xls)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700"
              />
            </div>
          )}

          {/* File Info - Hide after parsing */}
          {file && parsedData.length === 0 && (
            <div className="bg-slate-700 p-3 rounded-md">
              <p className="text-white text-sm">
                <strong>Selected file:</strong> {file.name}
              </p>
              <p className="text-gray-300 text-sm">
                <strong>Size:</strong> {(file.size / 1024).toFixed(2)} KB
              </p>
            </div>
          )}

          {/* Sheet Selection - Show when multiple sheets (after "Open workbook") */}
          {sheets.length > 1 && parsedData.length === 0 && (
            <div>
              <label className="block text-white text-sm font-medium mb-2">
                Choose sheet to load ({sheets.length} sheets found)
              </label>
              <select
                value={selectedSheet}
                onChange={(e) => setSelectedSheet(e.target.value)}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-600 text-white p-3 rounded-md">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Preview Data - Show after parsing */}
          {parsedData.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">
                Preview ({parsedData.length} rows found)
              </h3>
              
              {/* Large scrollable table */}
              <div className="border border-slate-600 rounded-md bg-slate-700 max-h-96 overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Row</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">CUE</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Segment Name</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Duration</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Shot Type</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">PPT/QA</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Program Type</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Notes</th>
                      <th className="px-3 py-2 text-left text-white text-sm border-r border-slate-500">Assets</th>
                      <th className="px-3 py-2 text-left text-white text-sm">Speakers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((row, index) => (
                      <tr key={index} className="border-t border-slate-600 hover:bg-slate-600">
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">{row.row}</td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">{row.cue}</td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">{row.segmentName}</td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">{row.duration}</td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">{row.shotType}</td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">
                          {row.hasPPT && 'PPT '}
                          {row.hasQA && 'QA'}
                          {!row.hasPPT && !row.hasQA && '-'}
                        </td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">{row.programType}</td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">
                          {row.notes ? (row.notes.length > 30 ? `${row.notes.substring(0, 30)}...` : row.notes) : 'None'}
                        </td>
                        <td className="px-3 py-2 text-white text-sm border-r border-slate-500">
                          {row.assets ? (row.assets.length > 30 ? `${row.assets.substring(0, 30)}...` : row.assets) : 'None'}
                        </td>
                        <td className="px-3 py-2 text-white text-sm">
                          {row.speakers ? (() => {
                            try {
                              const speakers = JSON.parse(row.speakers);
                              if (speakers.length > 0) {
                                return (
                                  <div className="space-y-1">
                                    <div className="font-medium">{speakers.length} speaker(s)</div>
                                    {speakers.map((speaker, idx) => (
                                      <div key={idx} className="text-xs text-gray-300">
                                        <div>• {speaker.fullName} ({speaker.location})</div>
                                        <div className="text-gray-400">  {speaker.title}</div>
                                        {speaker.org && <div className="text-gray-400">  {speaker.org}</div>}
                                        {speaker.photoUrl && (
                                          <div className="text-blue-300 text-xs truncate max-w-xs">
                                            📸 {speaker.photoUrl.length > 40 ? `${speaker.photoUrl.substring(0, 40)}...` : speaker.photoUrl}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              return 'None';
                            } catch {
                              return 'None';
                            }
                          })() : 'None'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
        </div>

        <footer className="shrink-0 border-t border-slate-600 px-6 py-4 bg-slate-800 rounded-b-lg">
          {parsedData.length === 0 ? (
            <div className="flex justify-center gap-4">
              <button
                onClick={sheets.length > 1 ? parseSelectedSheet : handleParse}
                disabled={!file || isProcessing || (sheets.length > 1 && !selectedSheet)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
              >
                {isProcessing
                  ? (sheets.length > 1 ? 'Loading...' : 'Opening...')
                  : (sheets.length > 1 ? 'Load sheet data' : 'Open workbook')}
              </button>
              <button
                onClick={handleClose}
                className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex justify-center gap-4">
              <button
                onClick={handleImport}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition-colors"
              >
                Import {parsedData.length} Items
              </button>
              <button
                onClick={() => {
                  setFile(null);
                  setParsedData([]);
                  setError(null);
                  setSheets([]);
                  setSelectedSheet('');
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors"
              >
                Import Another File
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
};

export default ExcelImportModal;