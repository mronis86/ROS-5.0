#!/usr/bin/env python3
"""
Run of Show - Local Server (Python Version)
Serves the React app and provides API endpoints for VMIX integration
"""

import os
import json
import http.server
import socketserver
from urllib.parse import urlparse, parse_qs
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

PORT = 3002
DATABASE_URL = os.getenv('NEON_DATABASE_URL') or os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print('❌ Database connection string not found!')
    print('Please set NEON_DATABASE_URL or DATABASE_URL in .env file')
    exit(1)

print('✅ Connected to Neon database')
print(f'🌐 Database host: {DATABASE_URL.split("@")[1].split("/")[0] if "@" in DATABASE_URL else "unknown"}')


def get_db_connection():
    """Get database connection"""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def fetch_run_of_show_data(event_id):
    """Fetch run of show data from database"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT * FROM run_of_show_data WHERE event_id = %s', (event_id,))
        data = cur.fetchone()
        cur.close()
        conn.close()
        return dict(data) if data else None
    except Exception as e:
        print(f'❌ Database error: {e}')
        return None


def calculate_start_time(schedule_items, current_item, master_start_time):
    """Calculate start time for a schedule item"""
    try:
        item_index = schedule_items.index(current_item)
        
        # If indented, no start time
        if current_item.get('isIndented'):
            return ''
        
        # Calculate total seconds up to this item
        total_seconds = 0
        for i in range(item_index):
            item = schedule_items[i]
            if not item.get('isIndented'):
                total_seconds += (item.get('durationHours', 0) * 3600 + 
                                item.get('durationMinutes', 0) * 60 + 
                                item.get('durationSeconds', 0))
        
        # Add to master start time
        start_hours, start_minutes = map(int, master_start_time.split(':'))
        start_seconds = start_hours * 3600 + start_minutes * 60
        total_start_seconds = start_seconds + total_seconds
        
        final_hours = int((total_start_seconds / 3600) % 24)
        final_minutes = int((total_start_seconds % 3600) / 60)
        
        # Convert to 12-hour format
        period = 'AM' if final_hours < 12 else 'PM'
        display_hours = final_hours % 12
        if display_hours == 0:
            display_hours = 12
        
        return f"{display_hours}:{final_minutes:02d} {period}"
    except Exception as e:
        print(f'Error calculating start time: {e}')
        return ''


class RequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom request handler for serving React app and API"""
    
    def __init__(self, *args, **kwargs):
        # Serve files from the 'dist' directory
        super().__init__(*args, directory='dist', **kwargs)
    
    def do_GET(self):
        """Handle GET requests"""
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        query_params = parse_qs(parsed_path.query)
        
        # API endpoints
        if path.startswith('/api/'):
            self.handle_api_request(path, query_params)
        else:
            # Serve static files from dist directory
            # For SPA, redirect all non-API routes to index.html
            if not path.startswith('/assets/') and not os.path.exists(f'dist{path}'):
                self.path = '/index.html'
            super().do_GET()
    
    def handle_api_request(self, path, query_params):
        """Handle API requests"""
        event_id = query_params.get('eventId', [None])[0]
        
        if not event_id:
            self.send_error_response(400, 'Event ID is required')
            return
        
        # Lower Thirds endpoints
        if path == '/api/lower-thirds.xml':
            self.serve_lower_thirds_xml(event_id)
        elif path == '/api/lower-thirds.csv':
            self.serve_lower_thirds_csv(event_id)
        
        # Schedule endpoints
        elif path == '/api/schedule.xml':
            self.serve_schedule_xml(event_id)
        elif path == '/api/schedule.csv':
            self.serve_schedule_csv(event_id)
        
        # Custom Columns endpoints
        elif path == '/api/custom-columns.xml':
            self.serve_custom_columns_xml(event_id)
        elif path == '/api/custom-columns.csv':
            self.serve_custom_columns_csv(event_id)
        
        # Run of Show Data endpoint
        elif path.startswith('/api/run-of-show-data/'):
            event_id_from_path = path.split('/')[-1]
            self.serve_run_of_show_data(event_id_from_path)
        
        else:
            self.send_error_response(404, 'Endpoint not found')
    
    def serve_lower_thirds_xml(self, event_id):
        """Serve Lower Thirds XML data"""
        data = fetch_run_of_show_data(event_id)
        if not data or not data.get('schedule_items'):
            self.send_xml_response('<?xml version="1.0" encoding="UTF-8"?><data><lower_thirds></lower_thirds></data>')
            return
        
        schedule_items = data['schedule_items']
        lower_thirds_data = []
        
        for item in schedule_items:
            speakers = []
            if item.get('speakersText'):
                try:
                    speakers_array = json.loads(item['speakersText']) if isinstance(item['speakersText'], str) else item['speakersText']
                    for speaker in speakers_array:
                        speakers.append({
                            'title': speaker.get('fullName') or speaker.get('name', ''),
                            'subtitle': ', '.join(filter(None, [speaker.get('title'), speaker.get('org')])),
                            'photo': speaker.get('photoLink', '')
                        })
                except Exception as e:
                    print(f'Error parsing speakers: {e}')
            
            lower_thirds_data.append({
                'id': str(item['id']),
                'cue': item.get('customFields', {}).get('cue', ''),
                'program': item.get('programType', ''),
                'segmentName': item.get('segmentName', ''),
                'speakers': speakers
            })
        
        # Generate XML
        xml_items = []
        for item in lower_thirds_data:
            speakers_array = [''] * 21
            for idx, speaker in enumerate(item['speakers'][:7]):
                base_idx = idx * 3
                speakers_array[base_idx] = speaker['title']
                speakers_array[base_idx + 1] = speaker['subtitle']
                speakers_array[base_idx + 2] = speaker['photo']
            
            xml_items.append(f'''
    <item>
      <id>{item['id']}</id>
      <cue><![CDATA[{item['cue']}]]></cue>
      <program><![CDATA[{item['program']}]]></program>
      <segment_name><![CDATA[{item['segmentName']}]]></segment_name>
      <speaker_1_name><![CDATA[{speakers_array[0]}]]></speaker_1_name>
      <speaker_1_title_org><![CDATA[{speakers_array[1]}]]></speaker_1_title_org>
      <speaker_1_photo><![CDATA[{speakers_array[2]}]]></speaker_1_photo>
      <speaker_2_name><![CDATA[{speakers_array[3]}]]></speaker_2_name>
      <speaker_2_title_org><![CDATA[{speakers_array[4]}]]></speaker_2_title_org>
      <speaker_2_photo><![CDATA[{speakers_array[5]}]]></speaker_2_photo>
      <speaker_3_name><![CDATA[{speakers_array[6]}]]></speaker_3_name>
      <speaker_3_title_org><![CDATA[{speakers_array[7]}]]></speaker_3_title_org>
      <speaker_3_photo><![CDATA[{speakers_array[8]}]]></speaker_3_photo>
      <speaker_4_name><![CDATA[{speakers_array[9]}]]></speaker_4_name>
      <speaker_4_title_org><![CDATA[{speakers_array[10]}]]></speaker_4_title_org>
      <speaker_4_photo><![CDATA[{speakers_array[11]}]]></speaker_4_photo>
      <speaker_5_name><![CDATA[{speakers_array[12]}]]></speaker_5_name>
      <speaker_5_title_org><![CDATA[{speakers_array[13]}]]></speaker_5_title_org>
      <speaker_5_photo><![CDATA[{speakers_array[14]}]]></speaker_5_photo>
      <speaker_6_name><![CDATA[{speakers_array[15]}]]></speaker_6_name>
      <speaker_6_title_org><![CDATA[{speakers_array[16]}]]></speaker_6_title_org>
      <speaker_6_photo><![CDATA[{speakers_array[17]}]]></speaker_6_photo>
      <speaker_7_name><![CDATA[{speakers_array[18]}]]></speaker_7_name>
      <speaker_7_title_org><![CDATA[{speakers_array[19]}]]></speaker_7_title_org>
      <speaker_7_photo><![CDATA[{speakers_array[20]}]]></speaker_7_photo>
    </item>''')
        
        xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<data>
  <timestamp>{datetime.utcnow().isoformat()}Z</timestamp>
  <event_id>{event_id}</event_id>
  <lower_thirds>{''.join(xml_items)}
  </lower_thirds>
</data>'''
        
        self.send_xml_response(xml)
    
    def serve_lower_thirds_csv(self, event_id):
        """Serve Lower Thirds CSV data"""
        data = fetch_run_of_show_data(event_id)
        if not data or not data.get('schedule_items'):
            self.send_csv_response('Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n')
            return
        
        schedule_items = data['schedule_items']
        csv_rows = ['Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo']
        
        for idx, item in enumerate(schedule_items, 1):
            speakers = []
            if item.get('speakersText'):
                try:
                    speakers_array = json.loads(item['speakersText']) if isinstance(item['speakersText'], str) else item['speakersText']
                    for speaker in speakers_array:
                        speakers.append({
                            'title': speaker.get('fullName') or speaker.get('name', ''),
                            'subtitle': ', '.join(filter(None, [speaker.get('title'), speaker.get('org')])),
                            'photo': speaker.get('photoLink', '')
                        })
                except:
                    pass
            
            speakers_array = [''] * 21
            for s_idx, speaker in enumerate(speakers[:7]):
                base_idx = s_idx * 3
                speakers_array[base_idx] = speaker['title']
                speakers_array[base_idx + 1] = speaker['subtitle']
                speakers_array[base_idx + 2] = speaker['photo']
            
            def escape_csv(s):
                return f'"{s.replace(chr(34), chr(34)+chr(34))}"'
            
            row = [
                str(idx),
                escape_csv(item.get('customFields', {}).get('cue', '')),
                escape_csv(item.get('programType', '')),
                escape_csv(item.get('segmentName', ''))
            ]
            row.extend([escape_csv(s) for s in speakers_array])
            csv_rows.append(','.join(row))
        
        self.send_csv_response('\n'.join(csv_rows))
    
    def serve_schedule_xml(self, event_id):
        """Serve Schedule XML data"""
        data = fetch_run_of_show_data(event_id)
        if not data or not data.get('schedule_items'):
            self.send_xml_response('<?xml version="1.0" encoding="UTF-8"?><data><schedule></schedule></data>')
            return
        
        schedule_items = data['schedule_items']
        master_start_time = data.get('settings', {}).get('masterStartTime', '09:00')
        
        xml_items = []
        for idx, item in enumerate(schedule_items, 1):
            start_time = calculate_start_time(schedule_items, item, master_start_time)
            xml_items.append(f'''
    <item>
      <id>{item['id']}</id>
      <row>{idx}</row>
      <segment_name><![CDATA[{item.get('segmentName', '')}]]></segment_name>
      <start_time><![CDATA[{start_time}]]></start_time>
    </item>''')
        
        xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<data>
  <timestamp>{datetime.utcnow().isoformat()}Z</timestamp>
  <event_id>{event_id}</event_id>
  <schedule>{''.join(xml_items)}
  </schedule>
</data>'''
        
        self.send_xml_response(xml)
    
    def serve_schedule_csv(self, event_id):
        """Serve Schedule CSV data"""
        data = fetch_run_of_show_data(event_id)
        if not data or not data.get('schedule_items'):
            self.send_csv_response('Row,Segment Name,Start Time\n')
            return
        
        schedule_items = data['schedule_items']
        master_start_time = data.get('settings', {}).get('masterStartTime', '09:00')
        
        csv_rows = ['Row,Segment Name,Start Time']
        for idx, item in enumerate(schedule_items, 1):
            start_time = calculate_start_time(schedule_items, item, master_start_time)
            def escape_csv(s):
                return f'"{s.replace(chr(34), chr(34)+chr(34))}"'
            
            row = [str(idx), escape_csv(item.get('segmentName', '')), escape_csv(start_time)]
            csv_rows.append(','.join(row))
        
        self.send_csv_response('\n'.join(csv_rows))
    
    def serve_custom_columns_xml(self, event_id):
        """Serve Custom Columns XML data"""
        data = fetch_run_of_show_data(event_id)
        if not data or not data.get('schedule_items'):
            self.send_xml_response('<?xml version="1.0" encoding="UTF-8"?><data><custom_columns></custom_columns></data>')
            return
        
        schedule_items = data['schedule_items']
        
        xml_items = []
        for idx, item in enumerate(schedule_items, 1):
            custom_fields = item.get('customFields', {})
            custom_fields_xml = ''.join([f'<{key}><![CDATA[{value}]]></{key}>' for key, value in custom_fields.items()])
            
            xml_items.append(f'''
    <item>
      <id>{item['id']}</id>
      <row>{idx}</row>
      <cue><![CDATA[{custom_fields.get('cue', '')}]]></cue>
      {custom_fields_xml}
    </item>''')
        
        xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<data>
  <timestamp>{datetime.utcnow().isoformat()}Z</timestamp>
  <event_id>{event_id}</event_id>
  <custom_columns>{''.join(xml_items)}
  </custom_columns>
</data>'''
        
        self.send_xml_response(xml)
    
    def serve_custom_columns_csv(self, event_id):
        """Serve Custom Columns CSV data"""
        data = fetch_run_of_show_data(event_id)
        if not data or not data.get('schedule_items'):
            self.send_csv_response('Row,Cue\n')
            return
        
        schedule_items = data['schedule_items']
        
        # Get all unique custom field keys
        all_keys = set()
        for item in schedule_items:
            all_keys.update(item.get('customFields', {}).keys())
        
        headers = ['Row', 'Cue'] + sorted(all_keys - {'cue'})
        csv_rows = [','.join(headers)]
        
        def escape_csv(s):
            return f'"{s.replace(chr(34), chr(34)+chr(34))}"'
        
        for idx, item in enumerate(schedule_items, 1):
            custom_fields = item.get('customFields', {})
            row = [str(idx), escape_csv(custom_fields.get('cue', ''))]
            for key in sorted(all_keys - {'cue'}):
                row.append(escape_csv(custom_fields.get(key, '')))
            csv_rows.append(','.join(row))
        
        self.send_csv_response('\n'.join(csv_rows))
    
    def serve_run_of_show_data(self, event_id):
        """Serve run of show data as JSON"""
        data = fetch_run_of_show_data(event_id)
        if not data:
            self.send_json_response({'error': 'Event not found'}, 404)
            return
        
        self.send_json_response(data)
    
    def send_xml_response(self, xml_content):
        """Send XML response"""
        self.send_response(200)
        self.send_header('Content-type', 'application/xml; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(xml_content.encode('utf-8'))
    
    def send_csv_response(self, csv_content):
        """Send CSV response"""
        self.send_response(200)
        self.send_header('Content-type', 'text/csv; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(csv_content.encode('utf-8'))
    
    def send_json_response(self, data, status=200):
        """Send JSON response"""
        self.send_response(status)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
    
    def send_error_response(self, status, message):
        """Send error response"""
        self.send_response(status)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(message.encode('utf-8'))
    
    def log_message(self, format, *args):
        """Override to customize logging"""
        print(f'[{self.log_date_time_string()}] {format % args}')


if __name__ == '__main__':
    with socketserver.TCPServer(("", PORT), RequestHandler) as httpd:
        print('')
        print('=' * 50)
        print('  🚀 ROS Local Server (Python) Started!')
        print('=' * 50)
        print(f'  📱 React App:  http://localhost:{PORT}')
        print(f'  🔌 API Server: http://localhost:{PORT}/api')
        print('=' * 50)
        print('')
        print('  Press Ctrl+C to stop the server')
        print('')
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n\n🛑 Server stopped')
            httpd.shutdown()

