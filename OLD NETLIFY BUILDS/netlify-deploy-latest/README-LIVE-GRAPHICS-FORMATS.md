# Live Graphics Data - Multiple Format Support

The live graphics pages now support multiple output formats to ensure compatibility with various systems including vMix, Excel, and other applications.

## Available Pages

1. **Lower Thirds Live Data** (`lower-thirds-live.html`)
2. **Custom Graphics Live Data** (`custom-graphics-live.html`) 
3. **Schedule Live Data** (`schedule-live.html`)

## Supported Formats

### JSON (Default)
- **URL**: `?format=json` or no parameter
- **Use Case**: Web applications, APIs, general data exchange
- **Features**: Clean JSON with escaped characters, no trailing commas

### XML (Lower Thirds Only)
- **URL**: `?format=xml`
- **Use Case**: vMix compatibility
- **Features**: Flattened structure with `<item>` elements as direct children of `<speakers>`
- **XML Escaping**: All special characters (`&`, `<`, `>`, `"`, `'`) are properly escaped

### CSV
- **URL**: `?format=csv`
- **Use Case**: Excel import, spreadsheet applications
- **Features**: 
  - Comma-separated values
  - Proper quote escaping for text fields
  - Headers included
  - Excel-compatible format

### TXT (Tab-Separated)
- **URL**: `?format=txt`
- **Use Case**: Simple text processing, basic import tools
- **Features**:
  - Tab-separated values
  - No quote escaping needed
  - Headers included
  - Simple format for basic tools

## Usage Examples

### Lower Thirds Data
```
# JSON format (default)
https://yoursite.netlify.app/lower-thirds-live.html?eventId=12345

# XML format for vMix
https://yoursite.netlify.app/lower-thirds-live.html?eventId=12345&format=xml

# CSV format for Excel
https://yoursite.netlify.app/lower-thirds-live.html?eventId=12345&format=csv

# TXT format for simple import
https://yoursite.netlify.app/lower-thirds-live.html?eventId=12345&format=txt
```

### Custom Graphics Data
```
# JSON format (default)
https://yoursite.netlify.app/custom-graphics-live.html?eventId=12345

# CSV format for Excel
https://yoursite.netlify.app/custom-graphics-live.html?eventId=12345&format=csv

# TXT format for simple import
https://yoursite.netlify.app/custom-graphics-live.html?eventId=12345&format=txt
```

### Schedule Data
```
# JSON format (default)
https://yoursite.netlify.app/schedule-live.html?eventId=12345

# CSV format for Excel
https://yoursite.netlify.app/schedule-live.html?eventId=12345&format=csv

# TXT format for simple import
https://yoursite.netlify.app/schedule-live.html?eventId=12345&format=txt
```

## Data Structure

### Lower Thirds CSV/TXT Columns
- Row, Cue, Program, Name, Title/Org, Photo

### Custom Graphics CSV/TXT Columns
- Event, Generated, Item ID, Segment Name, Program Type, Duration, Shot Type, Notes, Assets, Speakers, Has PPT, Has QA

### Schedule CSV/TXT Columns
- Event, Generated, Item ID, Segment Name, Program Type, Duration, Shot Type, Notes, Assets, Speakers, Has PPT, Has QA

## Live Updates

All formats update automatically every 10 seconds, fetching fresh data from Supabase. The format is preserved across updates.

## Troubleshooting

### vMix XML Issues
- Use the XML format specifically designed for vMix compatibility
- All XML characters are properly escaped
- Structure is flattened for vMix's expected format

### Excel Import Issues
- Use CSV format for best Excel compatibility
- All text fields are properly quoted and escaped
- Headers are included for easy identification

### General Import Issues
- Try TXT format for simple tab-separated data
- No special character handling needed
- Works with most basic import tools

## Technical Notes

- All formats maintain the same data structure and content
- JSON format includes character escaping for URLs (`&` → `\u0026`)
- Newlines in text fields are normalized to spaces
- No trailing commas in JSON output
- All formats include metadata (event, generated timestamp)

