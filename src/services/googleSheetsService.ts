// Google Sheets API integration for VMIX data
export interface GoogleSheetsConfig {
  spreadsheetId: string;
  apiKey: string;
  sheetName: string;
}

export interface VMIXLowerThird {
  id: string;
  cue: string;
  program: string;
  segmentName: string;
  speakers: Array<{
    name: string;
    title: string;
    photo: string;
  }>;
}

export class GoogleSheetsService {
  private config: GoogleSheetsConfig;

  constructor(config: GoogleSheetsConfig) {
    this.config = config;
  }

  // Generate CSV data for VMIX
  generateCSV(lowerThirds: VMIXLowerThird[]): string {
    const headers = [
      'Row',
      'Cue', 
      'Program',
      'Segment Name',
      'Speaker 1 Name',
      'Speaker 1 Title/Org',
      'Speaker 1 Photo',
      'Speaker 2 Name',
      'Speaker 2 Title/Org', 
      'Speaker 2 Photo',
      'Speaker 3 Name',
      'Speaker 3 Title/Org',
      'Speaker 3 Photo',
      'Speaker 4 Name',
      'Speaker 4 Title/Org',
      'Speaker 4 Photo',
      'Speaker 5 Name',
      'Speaker 5 Title/Org',
      'Speaker 5 Photo',
      'Speaker 6 Name',
      'Speaker 6 Title/Org',
      'Speaker 6 Photo',
      'Speaker 7 Name',
      'Speaker 7 Title/Org',
      'Speaker 7 Photo'
    ];

    const rows = lowerThirds.map((item, index) => {
      const speakers = new Array(21).fill('');
      
      if (item.speakers && item.speakers.length > 0) {
        item.speakers.forEach((speaker, speakerIndex) => {
          if (speakerIndex < 7) {
            const baseIdx = speakerIndex * 3;
            speakers[baseIdx] = speaker.name || '';
            speakers[baseIdx + 1] = speaker.title || '';
            speakers[baseIdx + 2] = speaker.photo || '';
          }
        });
      }

      const escapeCsv = (str: string) => `"${String(str || '').replace(/"/g, '""')}"`;
      
      return [
        index + 1,
        escapeCsv(item.cue),
        escapeCsv(item.program),
        escapeCsv(item.segmentName),
        ...speakers.map(escapeCsv)
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  // Generate XML data for VMIX
  generateXML(lowerThirds: VMIXLowerThird[]): string {
    const items = lowerThirds.map(item => {
      const speakers = new Array(21).fill('');
      
      if (item.speakers && item.speakers.length > 0) {
        item.speakers.forEach((speaker, speakerIndex) => {
          if (speakerIndex < 7) {
            const baseIdx = speakerIndex * 3;
            speakers[baseIdx] = speaker.name || '';
            speakers[baseIdx + 1] = speaker.title || '';
            speakers[baseIdx + 2] = speaker.photo || '';
          }
        });
      }

      return `
    <item>
      <id>${item.id}</id>
      <cue><![CDATA[${item.cue || ''}]]></cue>
      <program><![CDATA[${item.program || ''}]]></program>
      <segment_name><![CDATA[${item.segmentName || ''}]]></segment_name>
      <speaker_1_name><![CDATA[${speakers[0]}]]></speaker_1_name>
      <speaker_1_title_org><![CDATA[${speakers[1]}]]></speaker_1_title_org>
      <speaker_1_photo><![CDATA[${speakers[2]}]]></speaker_1_photo>
      <speaker_2_name><![CDATA[${speakers[3]}]]></speaker_2_name>
      <speaker_2_title_org><![CDATA[${speakers[4]}]]></speaker_2_title_org>
      <speaker_2_photo><![CDATA[${speakers[5]}]]></speaker_2_photo>
      <speaker_3_name><![CDATA[${speakers[6]}]]></speaker_3_name>
      <speaker_3_title_org><![CDATA[${speakers[7]}]]></speaker_3_title_org>
      <speaker_3_photo><![CDATA[${speakers[8]}]]></speaker_3_photo>
      <speaker_4_name><![CDATA[${speakers[9]}]]></speaker_4_name>
      <speaker_4_title_org><![CDATA[${speakers[10]}]]></speaker_4_title_org>
      <speaker_4_photo><![CDATA[${speakers[11]}]]></speaker_4_photo>
      <speaker_5_name><![CDATA[${speakers[12]}]]></speaker_5_name>
      <speaker_5_title_org><![CDATA[${speakers[13]}]]></speaker_5_title_org>
      <speaker_5_photo><![CDATA[${speakers[14]}]]></speaker_5_photo>
      <speaker_6_name><![CDATA[${speakers[15]}]]></speaker_6_name>
      <speaker_6_title_org><![CDATA[${speakers[16]}]]></speaker_6_title_org>
      <speaker_6_photo><![CDATA[${speakers[17]}]]></speaker_6_photo>
      <speaker_7_name><![CDATA[${speakers[18]}]]></speaker_7_name>
      <speaker_7_title_org><![CDATA[${speakers[19]}]]></speaker_7_title_org>
      <speaker_7_photo><![CDATA[${speakers[20]}]]></speaker_7_photo>
    </item>`;
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <lower_thirds>
    ${items}
  </lower_thirds>
</data>`;
  }

  // Get Google Sheets data
  async getSheetData(): Promise<string[][]> {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}/values/${this.config.sheetName}?key=${this.config.apiKey}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Google Sheets API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.values || [];
    } catch (error) {
      console.error('Error fetching Google Sheets data:', error);
      throw error;
    }
  }

  // Update Google Sheets with VMIX data
  async updateSheetWithVMIXData(lowerThirds: VMIXLowerThird[]): Promise<void> {
    const csvData = this.generateCSV(lowerThirds);
    const rows = csvData.split('\n').map(row => row.split(','));
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.config.spreadsheetId}/values/${this.config.sheetName}?valueInputOption=RAW&key=${this.config.apiKey}`;
    
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: rows
        })
      });

      if (!response.ok) {
        throw new Error(`Google Sheets update error: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error updating Google Sheets:', error);
      throw error;
    }
  }

  // Generate Google Sheets published CSV URL
  getPublishedCSVUrl(): string {
    return `https://docs.google.com/spreadsheets/d/${this.config.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${this.config.sheetName}`;
  }

  // Generate Google Sheets published XML URL (via CSV conversion)
  getPublishedXMLUrl(): string {
    // Google Sheets doesn't publish XML directly, but we can use the CSV URL
    return this.getPublishedCSVUrl();
  }
}
