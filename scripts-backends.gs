// ================================
// KONFIGURASI UTAMA
// ================================
const CONFIG = {
  SPREADSHEET_ID: '1mkF5sZEUlzicIE2_32ZVppAYQ-gjSDgOWZX8wYIxx6E',
  SHEET_BARISTA: 'Database Barista',
  SHEET_PRESENSI: 'Presensi Barista',
  EMAIL_SENDER: 'sectorsevenyk@gmail.com',
  EMAIL_ADMIN: ['dafahentra@gmail.com'],
  NAMA_PERUSAHAAN: 'SECTOR SEVEN',
  CAFE_LOCATION: {
    lat: -7.7700682431027985,
    lng: 110.37967552722661
  },
  MAX_DISTANCE: 75,       // meters
  MAX_PIN_ATTEMPTS: 5,
  PIN_TIMEOUT: 300000     // 5 minutes
};

// Rate limiting cache (in-memory, per instance)
const pinAttempts = {};

// ================================
// HANDLER UTAMA
// ================================

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === 'getConfig')      return getPublicConfig();
    if (action === 'getBaristaList') return getBaristaListPublic();
    if (action === 'getHistory')     return getAttendanceHistory();

    return jsonResponse({ success: false, message: 'Invalid action' });
  } catch (error) {
    return jsonResponse({ success: false, message: error.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action !== 'attendance') {
      return jsonResponse({ success: false, message: 'Invalid action' });
    }

    const validation = validateAttendance(data);
    if (!validation.success) return jsonResponse(validation);

    const stateCheck = validateAttendanceState(data.baristaId, data.type);
    if (!stateCheck.success) return jsonResponse(stateCheck);

    const result = saveAttendance({
      timestamp:   data.timestamp,
      baristaId:   data.baristaId,
      baristaName: validation.baristaName,
      email:       validation.email,
      type:        data.type,
      location:    `${data.latitude}, ${data.longitude}`,
      distance:    validation.distance
    });

    return jsonResponse({
      success: true,
      message: `${data.type === 'in' ? 'Check In' : 'Check Out'} berhasil! ${validation.baristaName}`,
      data: result
    });

  } catch (error) {
    return jsonResponse({ success: false, message: error.toString() });
  }
}

// ================================
// CONFIG (Single Source of Truth)
// Sekaligus kirim barista list → frontend cukup 1 request saat init
// ================================

function getPublicConfig() {
  return jsonResponse({
    success: true,
    data: {
      cafeLocation: CONFIG.CAFE_LOCATION,
      maxDistance:  CONFIG.MAX_DISTANCE,
      baristaList:  getBaristaListData()  // ✅ Gabung dalam 1 response
    }
  });
}

// ================================
// BARISTA LIST
// ================================

// Helper internal — dipakai getPublicConfig & getBaristaListPublic
function getBaristaListData() {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_BARISTA);
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  const list = {};

  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === 'Aktif') {
      list[data[i][0]] = { name: data[i][1] }; // NO PIN — hanya ID & nama
    }
  }

  return list;
}

// Endpoint publik untuk auto-refresh barista list dari sheet
function getBaristaListPublic() {
  return jsonResponse({ success: true, data: getBaristaListData() });
}

// ================================
// VALIDASI
// ================================

function validateAttendance(data) {
  const { baristaId, pin, latitude, longitude, type } = data;

  if (!baristaId || !pin || !latitude || !longitude || !type) {
    return { success: false, message: 'Data tidak lengkap' };
  }

  const rateLimitCheck = checkRateLimit(baristaId);
  if (!rateLimitCheck.success) return rateLimitCheck;

  const baristaData = getBaristaData(baristaId);
  if (!baristaData) {
    recordFailedAttempt(baristaId);
    return { success: false, message: 'Barista tidak ditemukan' };
  }

  if (baristaData.status !== 'Aktif') {
    return { success: false, message: 'Akun barista tidak aktif' };
  }

  if (baristaData.pin !== pin) {
    recordFailedAttempt(baristaId);
    return { success: false, message: 'PIN salah!' };
  }

  const distance = calculateDistance(latitude, longitude, CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng);
  if (distance > CONFIG.MAX_DISTANCE) {
    return {
      success: false,
      message: `Anda terlalu jauh dari lokasi (${Math.round(distance)}m). Max ${CONFIG.MAX_DISTANCE}m`
    };
  }

  resetAttempts(baristaId);

  return {
    success: true,
    baristaName: baristaData.name,
    email: baristaData.email,
    distance
  };
}

// Cegah double check-in dan check-out tanpa check-in
function validateAttendanceState(baristaId, type) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
  if (!sheet) return { success: true };

  const lastEntry = findLastEntryToday(sheet, baristaId);

  if (type === 'in') {
    if (lastEntry && lastEntry.type === 'Check In' && lastEntry.status !== 'Complete') {
      return { success: false, message: 'Anda sudah Check In. Silakan Check Out terlebih dahulu.' };
    }
  }

  if (type === 'out') {
    if (!lastEntry || lastEntry.type === 'Check Out' || lastEntry.status === 'Complete') {
      return { success: false, message: 'Anda belum Check In hari ini.' };
    }
  }

  return { success: true };
}

function findLastEntryToday(sheet, baristaId) {
  const data = sheet.getDataRange().getValues();
  const todayStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    if (row[3].toString() !== baristaId.toString()) continue;

    const rowDate = row[1] instanceof Date
      ? Utilities.formatDate(row[1], 'Asia/Jakarta', 'yyyy-MM-dd')
      : (row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Jakarta', 'yyyy-MM-dd') : null);

    if (rowDate !== todayStr) continue;

    return {
      row: i + 1,
      type: row[5],
      status: row[11]
    };
  }

  return null;
}

// ================================
// RATE LIMITING
// ================================

function checkRateLimit(baristaId) {
  const now = Date.now();
  const attempts = pinAttempts[baristaId];
  if (!attempts) return { success: true };

  if (now - attempts.firstAttempt > CONFIG.PIN_TIMEOUT) {
    delete pinAttempts[baristaId];
    return { success: true };
  }

  if (attempts.count >= CONFIG.MAX_PIN_ATTEMPTS) {
    const remaining = Math.ceil((CONFIG.PIN_TIMEOUT - (now - attempts.firstAttempt)) / 60000);
    return { success: false, message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${remaining} menit` };
  }

  return { success: true };
}

function recordFailedAttempt(baristaId) {
  const now = Date.now();
  if (!pinAttempts[baristaId]) {
    pinAttempts[baristaId] = { count: 1, firstAttempt: now };
  } else {
    pinAttempts[baristaId].count++;
  }
}

function resetAttempts(baristaId) {
  delete pinAttempts[baristaId];
}

// ================================
// DATABASE
// ================================

// Private: untuk validasi PIN (server only, tidak dikirim ke frontend)
function getBaristaData(baristaId) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_BARISTA);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === baristaId.toString()) {
      return {
        id:     data[i][0],
        name:   data[i][1],
        pin:    data[i][2].toString(),
        email:  data[i][3],
        status: data[i][4]
      };
    }
  }
  return null;
}

// ================================
// SAVE ATTENDANCE
// ================================

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
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold').setBackground('#f5f5f5');
  }

  const timestamp = new Date(data.timestamp);
  const tanggalDate = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate());
  const waktu = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'HH:mm:ss');
  const tipeText = data.type === 'in' ? 'Check In' : 'Check Out';

  if (data.type === 'in') {
    sheet.appendRow([
      timestamp, tanggalDate, waktu,
      data.baristaId, data.baristaName, tipeText,
      data.location, Math.round(data.distance),
      timestamp, '', '', 'Check-In'
    ]);
    sheet.getRange(sheet.getLastRow(), 12).setBackground('#f0f0f0').setFontWeight('bold');
    sendEmailNotification(data.email, data.baristaName, 'Check In', timestamp);

  } else if (data.type === 'out') {
    const checkInData = findLastCheckIn(sheet, data.baristaId);

    if (!checkInData) {
      sheet.appendRow([
        timestamp, tanggalDate, waktu,
        data.baristaId, data.baristaName, tipeText,
        data.location, Math.round(data.distance),
        '', timestamp, '', 'Check-Out Tanpa Check-In'
      ]);
    } else {
      const durasiJam = calculateDuration(checkInData.timestamp, timestamp);

      sheet.appendRow([
        timestamp, tanggalDate, waktu,
        data.baristaId, data.baristaName, tipeText,
        data.location, Math.round(data.distance),
        checkInData.timestamp, timestamp, durasiJam, 'Check-Out'
      ]);

      sheet.getRange(checkInData.row, 10).setValue(timestamp);
      sheet.getRange(checkInData.row, 11).setValue(durasiJam);
      sheet.getRange(checkInData.row, 12).setValue('Complete').setBackground('#d1fae5').setFontWeight('bold');
    }

    sendEmailNotification(data.email, data.baristaName, 'Check Out', timestamp);
  }

  sheet.autoResizeColumns(1, 12);
  return { timestamp: timestamp.toISOString(), name: data.baristaName, type: data.type };
}

function findLastCheckIn(sheet, baristaId) {
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][3].toString() === baristaId.toString() &&
        data[i][5] === 'Check In' &&
        data[i][11] !== 'Complete') {
      return { row: i + 1, timestamp: data[i][0] };
    }
  }
  return null;
}

// ================================
// HISTORY
// ================================

function getAttendanceHistory() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_PRESENSI);
    if (!sheet) return jsonResponse({ success: true, data: [] });

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResponse({ success: true, data: [] });

    const todayStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd');
    const history = [];

    for (let i = data.length - 1; i >= 1; i--) {
      const row = data[i];
      if (!row[4] || !row[5]) continue;

      const dateObj = row[1] instanceof Date ? row[1] : (row[0] instanceof Date ? row[0] : null);
      if (!dateObj) continue;
      if (Utilities.formatDate(dateObj, 'Asia/Jakarta', 'yyyy-MM-dd') !== todayStr) continue;

      history.push({
        name:  row[4],
        type:  row[5] === 'Check In' ? 'in' : 'out',
        waktu: row[0] instanceof Date ? Utilities.formatDate(row[0], 'Asia/Jakarta', 'HH:mm:ss') : '00:00:00'
      });
    }

    return jsonResponse({ success: true, data: history });

  } catch (e) {
    return jsonResponse({ success: false, message: e.toString(), data: [] });
  }
}

// ================================
// EMAIL
// ================================

function sendEmailNotification(toEmail, baristaName, type, timestamp) {
  if (!toEmail) return;

  try {
    const waktuStr = Utilities.formatDate(timestamp, 'Asia/Jakarta', 'dd/MM/yyyy HH:mm:ss');
    const subject = `[${CONFIG.NAMA_PERUSAHAAN}] ${type} - ${baristaName}`;
    const body =
`Halo ${baristaName},

${type} Anda telah tercatat pada:
Waktu: ${waktuStr}

Terima kasih,
${CONFIG.NAMA_PERUSAHAAN}`;

    GmailApp.sendEmail(toEmail, subject, body, { from: CONFIG.EMAIL_SENDER });

    CONFIG.EMAIL_ADMIN.forEach(adminEmail => {
      GmailApp.sendEmail(adminEmail, `[Admin] ${subject}`, body, { from: CONFIG.EMAIL_SENDER });
    });

  } catch (e) {
    console.error('Failed to send email:', e);
  }
}

// ================================
// UTILITY
// ================================

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLam = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateDuration(checkIn, checkOut) {
  return ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(2);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}