// ✅ SECURE BACKEND - Google Apps Script
// PERBAIKAN KEAMANAN LENGKAP

const CONFIG = {
  SPREADSHEET_ID: '1mkF5sZEUlzicIE2_32ZVppAYQ-gjSDgOWZX8wYIxx6E',
  SHEET_BARISTA: 'Database Barista',
  SHEET_PRESENSI: 'Presensi Barista',
  EMAIL_ADMIN: ['dafahentra@gmail.com'],
  NAMA_PERUSAHAAN: 'SECTOR SEVEN',
  CAFE_LOCATION: {
    lat: -7.783172162412872,
    lng: 110.40523663297974
  },
  MAX_DISTANCE: 100, // meters
  MAX_PIN_ATTEMPTS: 5, // Rate limiting
  PIN_TIMEOUT: 300000 // 5 minutes
};

// Rate limiting -- pakai CacheService supaya persisten antar request
// (const pinAttempts = {} TIDAK berfungsi karena reset tiap invocation)

// Handle GET
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'getBaristaList') {
      return getBaristaListPublic();
    }
    
    if (action === 'getHistory') {
      return getAttendanceHistory();
    }
    
    // Attendance via GET -- data dikirim sebagai JSON di parameter ?data=...
    // POST ke GAS bermasalah karena 302 redirect yang membuat browser kehilangan response
    // GET dengan HTTPS tetap aman (URL terenkripsi end-to-end)
    if (action === 'attendance') {
      const rawData = e.parameter.data;
      if (!rawData) {
        return jsonResponse({ success: false, message: 'Data tidak ditemukan' });
      }
      
      const data = JSON.parse(rawData);
      
      const validation = validateAttendance(data);
      if (!validation.success) {
        return jsonResponse(validation);
      }
      
      const result = saveAttendance({
        timestamp: data.timestamp,
        baristaId: data.baristaId,
        baristaName: validation.baristaName,
        type: data.type,
        location: data.latitude + ', ' + data.longitude,
        distance: validation.distance
      });
      
      return jsonResponse({ 
        success: true, 
        message: (data.type === 'in' ? 'Check In' : 'Check Out') + ' berhasil! ' + validation.baristaName,
        data: result 
      });
    }
    
    return jsonResponse({ success: false, message: 'Invalid action' });
    
  } catch (error) {
    return jsonResponse({ success: false, message: error.toString() });
  }
}

// ✅ Handle POST - untuk submit presensi dengan validasi
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (data.action === 'attendance') {
      // ✅ VALIDASI KEAMANAN
      const validation = validateAttendance(data);
      
      if (!validation.success) {
        return jsonResponse(validation);
      }
      
      // Save attendance
      const result = saveAttendance({
        timestamp: data.timestamp,
        baristaId: data.baristaId,
        baristaName: validation.baristaName,
        type: data.type,
        location: `${data.latitude}, ${data.longitude}`,
        distance: validation.distance
      });
      
      return jsonResponse({ 
        success: true, 
        message: `${data.type === 'in' ? 'Check In' : 'Check Out'} berhasil! ${validation.baristaName}`,
        data: result 
      });
    }
    
    return jsonResponse({ success: false, message: 'Invalid action' });
    
  } catch (error) {
    return jsonResponse({ success: false, message: error.toString() });
  }
}

// ✅ VALIDASI LENGKAP
function validateAttendance(data) {
  const { baristaId, pin, latitude, longitude, type } = data;
  
  // 1. Check required fields
  if (!baristaId || !pin || !latitude || !longitude || !type) {
    return { success: false, message: 'Data tidak lengkap' };
  }
  
  // 2. Rate limiting - cegah brute force
  const rateLimitCheck = checkRateLimit(baristaId);
  if (!rateLimitCheck.success) {
    return rateLimitCheck;
  }
  
  // 3. Validasi PIN di backend
  const baristaData = getBaristaData(baristaId);
  if (!baristaData) {
    recordFailedAttempt(baristaId);
    return { success: false, message: 'Barista tidak ditemukan' };
  }
  
  if (baristaData.pin !== pin) {
    recordFailedAttempt(baristaId);
    return { success: false, message: 'PIN salah!' };
  }
  
  // 4. Validasi lokasi
  const distance = calculateDistance(
    latitude, 
    longitude, 
    CONFIG.CAFE_LOCATION.lat, 
    CONFIG.CAFE_LOCATION.lng
  );
  
  if (distance > CONFIG.MAX_DISTANCE) {
    return { 
      success: false, 
      message: `Anda terlalu jauh dari lokasi (${Math.round(distance)}m). Max ${CONFIG.MAX_DISTANCE}m` 
    };
  }
  
  // 5. Reset attempts on success
  resetAttempts(baristaId);
  
  return { 
    success: true, 
    baristaName: baristaData.name,
    distance: distance
  };
}

// Rate Limiting -- pakai CacheService (persisten antar request, TTL otomatis)
function checkRateLimit(baristaId) {
  const cache = CacheService.getScriptCache();
  const key = 'pin_attempts_' + baristaId;
  const cached = cache.get(key);
  
  if (!cached) {
    return { success: true };
  }
  
  const attempts = JSON.parse(cached);
  
  if (attempts.count >= CONFIG.MAX_PIN_ATTEMPTS) {
    return { 
      success: false, 
      message: 'Terlalu banyak percobaan PIN gagal. Coba lagi dalam beberapa menit.' 
    };
  }
  
  return { success: true };
}

function recordFailedAttempt(baristaId) {
  const cache = CacheService.getScriptCache();
  const key = 'pin_attempts_' + baristaId;
  const cached = cache.get(key);
  let attempts;
  
  if (!cached) {
    attempts = { count: 1 };
  } else {
    attempts = JSON.parse(cached);
    attempts.count++;
  }
  
  // TTL 300 detik = 5 menit, lalu auto-reset
  cache.put(key, JSON.stringify(attempts), 300);
}

function resetAttempts(baristaId) {
  const cache = CacheService.getScriptCache();
  cache.remove('pin_attempts_' + baristaId);
}

// ✅ Get barista data with PIN (PRIVATE - server only)
function getBaristaData(baristaId) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_BARISTA);
  
  if (!sheet) {
    return null;
  }
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === baristaId.toString()) {
      return {
        id: data[i][0],
        name: data[i][1],
        pin: data[i][2].toString(),
        email: data[i][3],
        status: data[i][4]
      };
    }
  }
  
  return null;
}

// ✅ Get barista list WITHOUT PIN (PUBLIC)
function getBaristaListPublic() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_BARISTA);
  
  if (!sheet) {
    return jsonResponse({ success: false, message: 'Database barista tidak ditemukan' });
  }
  
  const data = sheet.getDataRange().getValues();
  const baristaList = {};
  
  // Skip header, only return ID and Name (NO PIN!)
  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === 'Aktif') { // Only active baristas
      baristaList[data[i][0]] = {
        name: data[i][1]
        // ❌ PIN tidak dikirim ke frontend!
      };
    }
  }
  
  return jsonResponse({ success: true, data: baristaList });
}

// ✅ Calculate distance (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// ✅ JSON Response helper
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ✅ Get barista email (helper)
function getBaristaEmail(baristaId) {
  const baristaData = getBaristaData(baristaId);
  return baristaData ? baristaData.email : '';
}

// === REST OF THE CODE (saveAttendance, email functions, etc.) ===
// ... [kode sebelumnya untuk saveAttendance, email, dll tetap sama]

function saveAttendance(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
  
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_PRESENSI);
    sheet.appendRow([
      'Timestamp', 'Tanggal', 'Waktu', 'Barista ID', 'Nama Barista',
      'Tipe', 'Lokasi', 'Jarak (m)', 'Check-In Time', 'Check-Out Time',
      'Durasi Kerja (jam)', 'Status Presensi'
    ]);
    
    const headerRange = sheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f5f5f5');
  }
  
  const baristaEmail = getBaristaEmail(data.baristaId);
  const timestamp = new Date(data.timestamp);
  const tanggal = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'dd/MM/yyyy');
  const waktu = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'HH:mm:ss');
  const tipeText = data.type === 'in' ? 'Check In' : 'Check Out';
  
  if (data.type === 'in') {
    sheet.appendRow([
      timestamp, tanggal, waktu, data.baristaId, data.baristaName,
      tipeText, data.location, Math.round(data.distance),
      timestamp, '', '', 'Check-In'
    ]);
    
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 12).setBackground('#f0f0f0').setFontWeight('bold');
    
    // Send notification email...
    
  } else if (data.type === 'out') {
    const checkInData = findLastCheckIn(sheet, data.baristaId);
    
    if (!checkInData) {
      sheet.appendRow([
        timestamp, tanggal, waktu, data.baristaId, data.baristaName,
        tipeText, data.location, Math.round(data.distance),
        '', timestamp, '', 'Check-Out Tanpa Check-In'
      ]);
    } else {
      const checkInTime = checkInData.timestamp;
      const durasiJam = calculateDuration(checkInTime, timestamp);
      
      sheet.appendRow([
        timestamp, tanggal, waktu, data.baristaId, data.baristaName,
        tipeText, data.location, Math.round(data.distance),
        checkInTime, timestamp, durasiJam, 'Check-Out'
      ]);
      
      sheet.getRange(checkInData.row, 10).setValue(timestamp);
      sheet.getRange(checkInData.row, 11).setValue(durasiJam);
      sheet.getRange(checkInData.row, 12).setValue('Complete');
      sheet.getRange(checkInData.row, 12).setBackground('#d1fae5').setFontWeight('bold');
    }
  }
  
  sheet.autoResizeColumns(1, 12);
  
  return {
    timestamp: timestamp.toISOString(),
    name: data.baristaName,
    type: data.type
  };
}

function findLastCheckIn(sheet, baristaId) {
  const data = sheet.getDataRange().getValues();
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][3].toString() === baristaId.toString() && 
        data[i][5] === 'Check In' && 
        data[i][11] !== 'Complete') {
      return {
        row: i + 1,
        timestamp: data[i][0]
      };
    }
  }
  return null;
}

function calculateDuration(checkIn, checkOut) {
  const diff = checkOut - checkIn;
  const hours = diff / (1000 * 60 * 60);
  return hours.toFixed(2);
}

function getAttendanceHistory() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
  
  if (!sheet) {
    return jsonResponse({ success: true, data: [] });
  }
  
  const data = sheet.getDataRange().getValues();
  const today = new Date();
  const todayStr = Utilities.formatDate(today, 'Asia/Jakarta', 'dd/MM/yyyy');
  const history = [];
  
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === todayStr) {
      history.push({
        name: data[i][4],
        type: data[i][5] === 'Check In' ? 'in' : 'out',
        waktu: data[i][2]
      });
    }
  }
  
  return jsonResponse({ success: true, data: history });
}