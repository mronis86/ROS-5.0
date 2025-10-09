# Google Sheets Export - New Features ✨

## 🎯 **What's New:**

### **1. Target Specific Sheets**
- You can now specify which sheet to write to
- The script will create the sheet if it doesn't exist
- Perfect for organizing different data types in separate sheets

### **2. Auto-Refresh Mode**
- Enable automatic updates to Google Sheets
- Set custom refresh intervals (5-300 seconds)
- Data is automatically loaded and pushed at the specified interval
- Perfect for live events where data changes frequently

---

## 📋 **How to Use:**

### **Target Sheet:**
1. Enter the sheet name in the "Target Sheet Name" field
2. Default is "Sheet1"
3. If the sheet doesn't exist, it will be created automatically
4. You can use different sheet names for different data types

### **Auto-Refresh:**
1. Toggle the "Auto-Refresh" switch ON
2. Set your desired refresh interval (in seconds)
3. The page will automatically:
   - Load data from your event
   - Push it to Google Sheets
   - Repeat at the specified interval
4. Leave the page open for continuous updates

---

## 🔧 **Updated Apps Script:**

The Apps Script now supports:
- **Target sheet selection** - Writes to the specified sheet
- **Auto-create sheets** - Creates sheets if they don't exist
- **Header formatting** - Automatically formats the header row with blue background

```javascript
function doPost(e) {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    
    // Get target sheet name (default to active sheet)
    var sheetName = data.sheetName || 'Sheet1';
    var sheet = spreadsheet.getSheetByName(sheetName);
    
    // If sheet doesn't exist, create it
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }
    
    // Clear existing data
    sheet.clear();
    
    // Write new data
    if (data.data && data.data.length > 0) {
      sheet.getRange(1, 1, data.data.length, data.data[0].length).setValues(data.data);
      
      // Format header row
      var headerRange = sheet.getRange(1, 1, 1, data.data[0].length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285f4');
      headerRange.setFontColor('#ffffff');
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      rows: data.data.length,
      sheet: sheetName
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## 💡 **Use Cases:**

### **Live Event Updates:**
- Enable auto-refresh with 30-second interval
- Keep the page open during your event
- Google Sheets will update automatically as you make changes

### **Multiple Data Types:**
- Use different sheet names for different data:
  - "LowerThirds" for speaker data
  - "Schedule" for timing data
  - "CustomFields" for custom columns

### **Manual Control:**
- Disable auto-refresh for manual updates
- Click "Push to Google Sheets" only when needed
- Perfect for final exports or one-time updates

---

## ⚙️ **Configuration:**

| Setting | Description | Default |
|---------|-------------|---------|
| Web App URL | Your Google Apps Script deployment URL | Required |
| Target Sheet Name | Name of the sheet to write to | Sheet1 |
| Auto-Refresh | Enable automatic updates | Off |
| Refresh Interval | Seconds between updates | 30 |

---

## ✅ **Benefits:**

1. **No manual updates** - Set it and forget it
2. **Live data sync** - Always up-to-date
3. **Organized data** - Separate sheets for different data types
4. **Formatted output** - Headers are automatically styled
5. **Zero cost** - No egress fees, Google handles everything

---

## 🚀 **Quick Start:**

1. Set up your Google Apps Script (one-time setup)
2. Enter the Web App URL
3. Choose your target sheet name
4. Enable auto-refresh if desired
5. Click "Load Data" then "Push to Google Sheets"
6. Done! Your data is now syncing automatically

**Perfect for live events, presentations, and real-time data sharing!** 🎉
