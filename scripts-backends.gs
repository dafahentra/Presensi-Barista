// Configuration Presensi Barista Baru
const CONFIG = {
  SPREADSHEET_ID: '1mkF5sZEUlzicIE2_32ZVppAYQ-gjSDgOWZX8wYIxx6E',
  SHEET_BARISTA: 'Database Barista',
  SHEET_PRESENSI: 'Presensi Barista',
  EMAIL_ADMIN: ['dafahentra@gmail.com'], // Array untuk support multiple admin
  NAMA_PERUSAHAAN: 'SECTOR SEVEN'
};

// Handle GET request (untuk fetch data)
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'getHistory') {
      return getAttendanceHistory();
    }
    
    if (action === 'getBarista') {
      return getBaristaList();
    }
    
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: 'Invalid action' })
    ).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Handle POST request (untuk submit presensi)
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // Save attendance to sheet
    const result = saveAttendance(data);
    
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, data: result })
    ).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// Save attendance to Presensi sheet
function saveAttendance(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
  
  // Create Presensi sheet if not exists
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_PRESENSI);
    // Add headers
    sheet.appendRow([
      'Timestamp',
      'Tanggal',
      'Waktu',
      'Barista ID',
      'Nama Barista',
      'Tipe',
      'Lokasi',
      'Jarak (m)',
      'Check-In Time',
      'Check-Out Time',
      'Durasi Kerja (jam)',
      'Status Presensi'
    ]);
    
    // Format header
    const headerRange = sheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f5f5f5');
    headerRange.setFontColor('#1d1d1f');
    headerRange.setBorder(true, true, true, true, false, false, '#e5e5e7', SpreadsheetApp.BorderStyle.SOLID);
  }
  
  // Get barista email from Barista sheet
  const baristaEmail = getBaristaEmail(data.baristaId);
  
  // Parse timestamp
  const timestamp = new Date(data.timestamp);
  const tanggal = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'dd/MM/yyyy');
  const waktu = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'HH:mm:ss');
  
  const tipeText = data.type === 'in' ? 'Check In' : 'Check Out';
  
  // Process based on type
  if (data.type === 'in') {
    // Check-In Process
    sheet.appendRow([
      timestamp,
      tanggal,
      waktu,
      data.baristaId,
      data.baristaName,
      tipeText,
      data.location,
      Math.round(data.distance),
      timestamp, // Check-In Time
      '', // Check-Out Time (empty)
      '', // Durasi (empty)
      'Check-In' // Status
    ]);
    
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 12).setBackground('#f0f0f0').setFontWeight('bold');
    
    // Send Check-In Email
    sendCheckInEmail({
      nama: data.baristaName,
      email: baristaEmail,
      timestamp: timestamp,
      lokasi: data.location,
      jarak: Math.round(data.distance)
    });
    
  } else if (data.type === 'out') {
    // Check-Out Process
    // Find last Check-In for this barista
    const checkInData = findLastCheckIn(sheet, data.baristaId);
    
    if (!checkInData) {
      // Check-Out without Check-In
      sheet.appendRow([
        timestamp,
        tanggal,
        waktu,
        data.baristaId,
        data.baristaName,
        tipeText,
        data.location,
        Math.round(data.distance),
        '', // No Check-In Time
        timestamp, // Check-Out Time
        '', // No duration
        'Check-Out Tanpa Check-In' // Status
      ]);
      
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, 12).setBackground('#fff3cd').setFontWeight('bold');
      
      // Send Alert Email
      sendAlertEmail({
        nama: data.baristaName,
        email: baristaEmail,
        timestamp: timestamp,
        alertMessage: 'Check-Out tanpa Check-In terdeteksi'
      });
      
    } else {
      // Valid Check-Out
      const checkInTime = checkInData.timestamp;
      const checkOutTime = timestamp;
      const durasiJam = calculateDuration(checkInTime, checkOutTime);
      
      // Add Check-Out row
      sheet.appendRow([
        timestamp,
        tanggal,
        waktu,
        data.baristaId,
        data.baristaName,
        tipeText,
        data.location,
        Math.round(data.distance),
        checkInTime, // Check-In Time from previous
        checkOutTime, // Check-Out Time
        durasiJam, // Duration
        'Check-Out' // Status
      ]);
      
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow, 12).setBackground('#f0f0f0').setFontWeight('bold');
      
      // Update Check-In row with Check-Out info
      sheet.getRange(checkInData.row, 10).setValue(checkOutTime); // Check-Out Time
      sheet.getRange(checkInData.row, 11).setValue(durasiJam); // Duration
      sheet.getRange(checkInData.row, 12).setValue('Complete'); // Status
      sheet.getRange(checkInData.row, 12).setBackground('#d1fae5').setFontWeight('bold');
      
      // Send Check-Out Email
      sendCheckOutEmail({
        nama: data.baristaName,
        email: baristaEmail,
        checkInTime: checkInTime,
        checkOutTime: checkOutTime,
        durasi: durasiJam,
        lokasi: data.location,
        jarak: Math.round(data.distance)
      });
    }
  }
  
  // Auto-resize columns
  sheet.autoResizeColumns(1, 12);
  
  return {
    timestamp: timestamp.toISOString(),
    name: data.baristaName,
    type: data.type,
    email: baristaEmail
  };
}

// Find last Check-In for barista
function findLastCheckIn(sheet, baristaId) {
  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    const rowBaristaId = data[i][3].toString();
    const rowTipe = data[i][5];
    const rowStatus = data[i][11];
    
    if (rowBaristaId === baristaId.toString() && rowTipe === 'Check In' && rowStatus !== 'Complete') {
      return {
        row: i + 1,
        timestamp: data[i][0]
      };
    }
  }
  
  return null;
}

// Calculate duration in hours
function calculateDuration(checkInTime, checkOutTime) {
  const diffMs = checkOutTime - checkInTime;
  const diffHours = diffMs / (1000 * 60 * 60);
  return Math.round(diffHours * 100) / 100;
}

// Get barista email from Barista sheet
function getBaristaEmail(baristaId) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_BARISTA);
  
  if (!sheet) return '';
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === baristaId.toString()) {
      return data[i][3]; // Email column (index 3)
    }
  }
  
  return '';
}

// Get attendance history - FIXED: Filter hanya hari ini
function getAttendanceHistory() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
    
    if (!sheet) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, data: [] })
      ).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Get all data
    const data = sheet.getDataRange().getValues();
    const history = [];
    
    // Get today's date (00:00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get tomorrow's date (00:00:00)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    Logger.log('Today start:', today.toISOString());
    Logger.log('Tomorrow start:', tomorrow.toISOString());
    
    // Loop through all rows (skip header)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Skip empty rows
      if (!row[0] || !row[4]) continue;
      
      // Parse date
      let rowDate;
      if (row[0] instanceof Date) {
        rowDate = row[0];
      } else {
        rowDate = new Date(row[0]);
      }
      
      // Filter: Only today's records
      if (rowDate >= today && rowDate < tomorrow) {
        const item = {
          timestamp: rowDate.toISOString(),
          tanggal: Utilities.formatDate(rowDate, 'Asia/Jakarta', 'dd/MM/yyyy'),
          waktu: typeof row[2] === 'string' ? row[2] : Utilities.formatDate(rowDate, 'Asia/Jakarta', 'HH:mm:ss'),
          baristaId: row[3],
          name: row[4],
          type: row[5] && row[5].toString().includes('Check In') ? 'in' : 'out',
          location: row[6] || '',
          distance: row[7] || 0
        };
        
        history.push(item);
      }
    }
    
    // Sort by timestamp descending (newest first)
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    Logger.log(`Found ${history.length} records for today`);
    
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, data: history })
    ).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('Error in getAttendanceHistory:', error.toString());
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, message: error.toString(), data: [] })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// === EMAIL FUNCTIONS WITH APPLE-LIKE DESIGN ===

function sendCheckInEmail(data) {
  const subject = `Check-In Berhasil - ${data.nama}`;
  
  const htmlBody = createEmailTemplate({
    title: 'Check-In Berhasil',
    subtitle: CONFIG.NAMA_PERUSAHAAN,
    mainMessage: `Halo, ${data.nama}`,
    subMessage: 'Check-In telah tercatat dalam sistem',
    highlightLabel: 'Waktu Check-In',
    highlightValue: Utilities.formatDate(data.timestamp, 'Asia/Jakarta', 'HH:mm'),
    highlightDate: Utilities.formatDate(data.timestamp, 'Asia/Jakarta', 'dd MMMM yyyy'),
    infoRows: [
      { label: 'Nama Barista', value: data.nama, bold: true },
      { label: 'Email', value: data.email },
      { label: 'Lokasi', value: data.lokasi },
      { label: 'Jarak', value: `${data.jarak} meter` }
    ],
    reminder: 'Jangan lupa untuk Check-Out saat selesai shift'
  });
  
  sendEmail(data.email, subject, htmlBody);
}

function sendCheckOutEmail(data) {
  const subject = `Check-Out Berhasil - ${data.nama} (${data.durasi} jam)`;
  
  const htmlBody = createEmailTemplate({
    title: 'Check-Out Berhasil',
    subtitle: `${CONFIG.NAMA_PERUSAHAAN} - Laporan Shift Selesai`,
    mainMessage: `Terima kasih, ${data.nama}`,
    subMessage: 'Shift telah selesai dan tercatat dalam sistem',
    highlightLabel: 'Total Durasi Kerja',
    highlightValue: `${data.durasi} jam`,
    highlightDate: '',
    infoRows: [
      { label: 'Nama Barista', value: data.nama, bold: true },
      { label: 'Check-In', value: Utilities.formatDate(data.checkInTime, 'Asia/Jakarta', 'HH:mm - dd MMM yyyy') },
      { label: 'Check-Out', value: Utilities.formatDate(data.checkOutTime, 'Asia/Jakarta', 'HH:mm - dd MMM yyyy') },
      { label: 'Durasi Kerja', value: `${data.durasi} jam`, bold: true }
    ],
    reminder: 'Kerja bagus hari ini! Istirahat yang cukup.'
  });
  
  sendEmail(data.email, subject, htmlBody);
}

function sendAlertEmail(data) {
  const subject = `[ALERT] ${data.nama} - ${data.alertMessage}`;
  
  const htmlBody = createEmailTemplate({
    title: 'Peringatan Presensi',
    subtitle: CONFIG.NAMA_PERUSAHAAN,
    mainMessage: data.alertMessage,
    subMessage: 'Mohon segera cek dan lakukan tindakan yang diperlukan',
    highlightLabel: 'Waktu Kejadian',
    highlightValue: Utilities.formatDate(data.timestamp, 'Asia/Jakarta', 'HH:mm'),
    highlightDate: Utilities.formatDate(data.timestamp, 'Asia/Jakarta', 'dd MMMM yyyy'),
    infoRows: [
      { label: 'Nama Barista', value: data.nama, bold: true },
      { label: 'Email', value: data.email }
    ],
    reminder: '',
    isAlert: true
  });
  
  // Send to all admins
  CONFIG.EMAIL_ADMIN.forEach(adminEmail => {
    sendEmail(adminEmail, subject, htmlBody);
  });
}

function createEmailTemplate(params) {
  const isAlert = params.isAlert || false;
  
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      
      <!-- Header -->
      <div style="background: ${isAlert ? '#ff3b30' : '#ffffff'}; padding: 48px 40px; text-align: center; border-bottom: 1px solid #f5f5f7;">
        <h1 style="color: ${isAlert ? '#ffffff' : '#1d1d1f'}; margin: 0 0 8px 0; font-size: 32px; font-weight: 600; letter-spacing: -0.5px;">
          ${params.title}
        </h1>
        <p style="color: ${isAlert ? 'rgba(255,255,255,0.9)' : '#86868b'}; margin: 0; font-size: 15px; font-weight: 400;">
          ${params.subtitle}
        </p>
      </div>
      
      <!-- Content -->
      <div style="padding: 48px 40px;">
        
        <!-- Main Message -->
        <div style="background: #f5f5f7; padding: 24px; border-radius: 12px; margin-bottom: 32px; text-align: center;">
          <p style="color: #1d1d1f; margin: 0 0 8px 0; font-size: 17px; font-weight: 600;">
            ${params.mainMessage}
          </p>
          <p style="color: #86868b; margin: 0; font-size: 15px; font-weight: 400; line-height: 1.5;">
            ${params.subMessage}
          </p>
        </div>
        
        <!-- Highlight Value -->
        <div style="background: #ffffff; padding: 40px; border-radius: 16px; margin-bottom: 32px; text-align: center; border: 1px solid #f5f5f7;">
          <p style="color: #86868b; margin: 0 0 12px 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
            ${params.highlightLabel}
          </p>
          <p style="color: #1d1d1f; margin: 0; font-size: 48px; font-weight: 600; letter-spacing: -1px;">
            ${params.highlightValue}
          </p>
          ${params.highlightDate ? `
          <p style="color: #86868b; margin: 16px 0 0 0; font-size: 15px; font-weight: 400;">
            ${params.highlightDate}
          </p>
          ` : ''}
        </div>
        
        <!-- Info Details -->
        <div style="background: #ffffff; padding: 32px; border-radius: 12px; margin-bottom: 24px; border: 1px solid #f5f5f7;">
          <table style="width: 100%; border-collapse: collapse;">
            ${params.infoRows.map(row => `
              <tr>
                <td style="padding: 14px 0; color: #86868b; font-size: 15px; font-weight: 400; border-bottom: 1px solid #f5f5f7;">
                  ${row.label}
                </td>
                <td style="padding: 14px 0; color: #1d1d1f; font-size: 15px; font-weight: ${row.bold ? '600' : '400'}; text-align: right; border-bottom: 1px solid #f5f5f7;">
                  ${row.value}
                </td>
              </tr>
            `).join('')}
          </table>
        </div>
        
        ${params.reminder ? `
        <!-- Reminder -->
        <div style="background: #f5f5f7; padding: 20px 24px; border-radius: 12px; text-align: center;">
          <p style="color: #1d1d1f; font-size: 15px; line-height: 1.6; margin: 0; font-weight: 500;">
            ${params.reminder}
          </p>
        </div>
        ` : ''}
        
      </div>
      
      <!-- Footer -->
      <div style="background: #f5f5f7; padding: 32px 40px; text-align: center; border-top: 1px solid #e5e5e7;">
        <p style="color: #86868b; font-size: 13px; margin: 0 0 8px 0; line-height: 1.5;">
          Email otomatis dari Sistem Presensi ${CONFIG.NAMA_PERUSAHAAN}
        </p>
        <p style="color: #86868b; font-size: 12px; margin: 0;">
          Mohon tidak membalas email ini
        </p>
      </div>
    </div>
  `;
}

function sendEmail(recipient, subject, htmlBody) {
  try {
    GmailApp.sendEmail(recipient, subject, '', {
      htmlBody: htmlBody,
      name: `Sistem Presensi ${CONFIG.NAMA_PERUSAHAAN}`
    });
    
    // Send copy to all admins if recipient is not admin
    if (!CONFIG.EMAIL_ADMIN.includes(recipient)) {
      CONFIG.EMAIL_ADMIN.forEach(adminEmail => {
        GmailApp.sendEmail(adminEmail, subject, '', {
          htmlBody: htmlBody,
          name: `Sistem Presensi ${CONFIG.NAMA_PERUSAHAAN}`
        });
      });
    }
    
    Logger.log(`Email sent to: ${recipient}`);
  } catch (error) {
    Logger.log(`Failed to send email: ${error.toString()}`);
  }
}

// Helper function to initialize sheets (RUN THIS MANUALLY FIRST)
function initializeSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  
  // Create Database Barista sheet
  let baristaSheet = ss.getSheetByName(CONFIG.SHEET_BARISTA);
  if (!baristaSheet) {
    baristaSheet = ss.insertSheet(CONFIG.SHEET_BARISTA);
    
    // Add headers
    baristaSheet.appendRow(['ID', 'Nama', 'PIN', 'Email', 'Status']);
    
    // Add sample data with emails
    baristaSheet.appendRow(['1', 'Dapek', '1234', 'dapek@sectorseven.com', 'Aktif']);
    baristaSheet.appendRow(['2', 'Siti', '2345', 'siti@sectorseven.com', 'Aktif']);
    baristaSheet.appendRow(['3', 'Depon', '3456', 'depon@sectorseven.com', 'Aktif']);
    baristaSheet.appendRow(['4', 'Abey', '4567', 'abey@sectorseven.com', 'Aktif']);
    baristaSheet.appendRow(['5', 'Cler', '5678', 'cler@sectorseven.com', 'Aktif']);
    
    // Format header
    const headerRange = baristaSheet.getRange(1, 1, 1, 5);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f5f5f7');
    headerRange.setFontColor('#1d1d1f');
    headerRange.setBorder(true, true, true, true, false, false, '#e5e5e7', SpreadsheetApp.BorderStyle.SOLID);
    
    baristaSheet.autoResizeColumns(1, 5);
    Logger.log('Database Barista sheet created');
  }
  
  // Create Presensi Barista sheet
  let presensiSheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
  if (!presensiSheet) {
    presensiSheet = ss.insertSheet(CONFIG.SHEET_PRESENSI);
    
    // Add headers
    presensiSheet.appendRow([
      'Timestamp',
      'Tanggal',
      'Waktu',
      'Barista ID',
      'Nama Barista',
      'Tipe',
      'Lokasi',
      'Jarak (m)',
      'Check-In Time',
      'Check-Out Time',
      'Durasi Kerja (jam)',
      'Status Presensi'
    ]);
    
    // Format header
    const headerRange = presensiSheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f5f5f7');
    headerRange.setFontColor('#1d1d1f');
    headerRange.setBorder(true, true, true, true, false, false, '#e5e5e7', SpreadsheetApp.BorderStyle.SOLID);
    
    presensiSheet.autoResizeColumns(1, 12);
    Logger.log('Presensi Barista sheet created');
  }
  
  Logger.log('All sheets initialized successfully!');
}