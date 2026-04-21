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

// Rate limiting — pakai PropertiesService agar persistent lintas instance

// ================================
// HANDLER UTAMA
// ================================

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === 'getConfig')      return getPublicConfig();
    if (action === 'getBaristaList') return getBaristaListPublic();
    if (action === 'getHistory')     return getAttendanceHistory();
    if (action === 'syncBarista')    { syncBaristaCache(); return jsonResponse({ success: true, message: 'Sync selesai' }); }
    if (action === 'verifyPin')      return verifyBaristaPin(e.parameter.baristaId, e.parameter.pin);
    if (action === 'validatePin')    return validatePinEndpoint(e.parameter.baristaId, e.parameter.pin);

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
// VERIFY PIN — untuk admin panel
// Dipanggil dari store-status Netlify Function
// Hanya return success/fail, tidak expose PIN
// ================================

function verifyBaristaPin(baristaId, pin) {
  if (!baristaId || !pin) {
    return jsonResponse({ success: false, message: 'Data tidak lengkap' });
  }

  const rateLimitCheck = checkRateLimit(baristaId);
  if (!rateLimitCheck.success) return jsonResponse(rateLimitCheck);

  const barista = getBaristaData(baristaId);
  if (!barista) {
    recordFailedAttempt(baristaId);
    return jsonResponse({ success: false, message: 'Barista tidak ditemukan' });
  }

  if (barista.status !== 'Aktif') {
    return jsonResponse({ success: false, message: 'Akun tidak aktif' });
  }

  const pinInput  = pin.toString().replace(/[^0-9]/g, '');
  const pinStored = barista.pin.toString().replace(/[^0-9]/g, '');

  if (pinInput !== pinStored) {
    recordFailedAttempt(baristaId);
    return jsonResponse({ success: false, message: 'PIN salah' });
  }

  resetAttempts(baristaId);
  return jsonResponse({ success: true, name: barista.name });
}

// ================================
// BARISTA LIST
// ================================

// Helper internal — dipakai getPublicConfig & getBaristaListPublic
// Baca dari cache PropertiesService agar konsisten dengan getBaristaData
function getBaristaListData() {
  const db   = loadBaristaCache();
  const list = {};
  for (const id in db) {
    if (db[id].status === 'Aktif') {
      list[id] = { name: db[id].name }; // NO PIN — hanya ID & nama
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

  // Strip non-digit dari kedua sisi agar aman dari formatting issue
  const pinInput  = pin.toString().replace(/[^0-9]/g, '');
  const pinStored = baristaData.pin.toString().replace(/[^0-9]/g, '');

  Logger.log('[validateAttendance] pinInput=[' + pinInput + '] pinStored=[' + pinStored + ']');

  if (pinStored !== pinInput) {
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
// RATE LIMITING — PropertiesService (persistent)
// ================================

function _rlKey(baristaId) {
  return 'rl_' + baristaId.toString();
}

function checkRateLimit(baristaId) {
  const props = PropertiesService.getScriptProperties();
  const raw   = props.getProperty(_rlKey(baristaId));
  if (!raw) return { success: true };

  const attempts = JSON.parse(raw);
  const now      = Math.floor(Date.now() / 1000); // detik

  if (now - attempts.firstAttempt > Math.floor(CONFIG.PIN_TIMEOUT / 1000)) {
    props.deleteProperty(_rlKey(baristaId));
    return { success: true };
  }

  if (attempts.count >= CONFIG.MAX_PIN_ATTEMPTS) {
    const remaining = Math.ceil(((CONFIG.PIN_TIMEOUT / 1000) - (now - attempts.firstAttempt)) / 60);
    return {
      success: false,
      message: `Terlalu banyak percobaan gagal. Coba lagi dalam ${remaining} menit`
    };
  }

  return { success: true };
}

function recordFailedAttempt(baristaId) {
  const props = PropertiesService.getScriptProperties();
  const key   = _rlKey(baristaId);
  const raw   = props.getProperty(key);
  const now   = Math.floor(Date.now() / 1000);

  if (!raw) {
    props.setProperty(key, JSON.stringify({ count: 1, firstAttempt: now }));
  } else {
    const attempts = JSON.parse(raw);
    attempts.count++;
    props.setProperty(key, JSON.stringify(attempts));
  }
}

function resetAttempts(baristaId) {
  PropertiesService.getScriptProperties().deleteProperty(_rlKey(baristaId));
}

// ================================
// DATABASE — PropertiesService Cache
// ================================

const BARISTA_CACHE_KEY = 'barista_db_v1';

// Baca semua barista dari cache. Jika kosong, sync dari Sheets.
function loadBaristaCache() {
  const raw = PropertiesService.getScriptProperties().getProperty(BARISTA_CACHE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* corrupt — re-sync */ }
  }
  return syncBaristaCache();
}

// Sync dari Sheets ke PropertiesService
function syncBaristaCache() {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_BARISTA);
  if (!sheet) { Logger.log('[sync] Sheet tidak ditemukan'); return {}; }

  const rows = sheet.getDataRange().getValues();
  const db   = {};

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;

    const id  = r[0].toString().trim();
    // Strip karakter non-digit agar aman dari locale formatting (misal: "2.809" → "2809")
    const pin = (r[2] !== undefined && r[2] !== null && r[2] !== '')
                  ? r[2].toString().replace(/[^0-9]/g, '')
                  : '';

    db[id] = {
      name:   (r[1] || '').toString().trim(),
      pin:    pin,
      email:  (r[3] || '').toString().trim(),
      status: (r[4] || '').toString().trim(),
    };

    Logger.log('[sync] id=' + id + ' name=' + db[id].name + ' pinLen=' + pin.length + ' status=' + db[id].status);
  }

  PropertiesService.getScriptProperties().setProperty(BARISTA_CACHE_KEY, JSON.stringify(db));
  Logger.log('[sync] Selesai — ' + Object.keys(db).length + ' barista');
  return db;
}

// Trigger otomatis: jalankan setiap kali sheet Database Barista diedit
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === CONFIG.SHEET_BARISTA) {
    Logger.log('[onEdit] Perubahan di Database Barista — sync cache...');
    syncBaristaCache();
  }
}

// Private: untuk validasi PIN (server only, tidak dikirim ke frontend)
function getBaristaData(baristaId) {
  const db  = loadBaristaCache();
  const key = baristaId.toString().trim();
  const b   = db[key];
  if (!b) {
    Logger.log('[getBaristaData] id=' + key + ' tidak ditemukan di cache');
    return null;
  }
  Logger.log('[getBaristaData] id=' + key + ' name=' + b.name + ' pinLen=' + b.pin.length);
  return { id: key, name: b.name, pin: b.pin, email: b.email, status: b.status };
}

// Validasi PIN saja — untuk admin panel (tidak perlu check lokasi/check-in)
function validatePinEndpoint(baristaId, pin) {
  if (!baristaId || !pin) {
    return jsonResponse({ success: false, message: 'Data tidak lengkap' });
  }

  const rateLimitCheck = checkRateLimit(baristaId);
  if (!rateLimitCheck.success) return jsonResponse(rateLimitCheck);

  const barista = getBaristaData(baristaId);
  if (!barista) {
    recordFailedAttempt(baristaId);
    return jsonResponse({ success: false, message: 'Barista tidak ditemukan' });
  }

  if (barista.status !== 'Aktif') {
    return jsonResponse({ success: false, message: 'Akun tidak aktif' });
  }

  const pinInput  = pin.toString().replace(/[^0-9]/g, '');
  const pinStored = barista.pin.toString().replace(/[^0-9]/g, '');

  if (pinInput !== pinStored) {
    recordFailedAttempt(baristaId);
    return jsonResponse({ success: false, message: 'PIN salah' });
  }

  resetAttempts(baristaId);
  return jsonResponse({ success: true, message: 'OK', name: barista.name });
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
    const history  = [];
    const LIMIT    = 100; // cegah timeout di sheet besar

    for (let i = data.length - 1; i >= 1 && history.length < LIMIT; i--) {
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