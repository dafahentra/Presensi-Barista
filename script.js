const CONFIG = {
    CAFE_LOCATION: {
        lat: -7.783446028514716,
        lng: 110.40502826594829
    },
    MAX_DISTANCE: 50, // meters
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyOZoOVgrIj4_bDDCVksCxnph0yrEAM_vGWHbTh4uiuVvxdzVcaRTE4O9hqs-BJ4_XyAA/exec' // Ganti dengan URL Apps Script
};

const BARISTA_DATA = {
    '1': { name: 'Dapek', pin: '1234' },
    '2': { name: 'Siti', pin: '2345' },
    '3': { name: 'Depon', pin: '3456' },
    '4': { name: 'Abey', pin: '4567' },
    '5': { name: 'Cler', pin: '5678' }
};

// Global state
let currentLocation = null;
let isInRange = false;

// DOM Elements
const elements = {
    datetime: document.getElementById('datetime'),
    locationStatus: document.getElementById('locationStatus'),
    baristaName: document.getElementById('baristaName'),
    pin: document.getElementById('pin'),
    checkInBtn: document.getElementById('checkInBtn'),
    checkOutBtn: document.getElementById('checkOutBtn'),
    message: document.getElementById('message'),
    todayHistory: document.getElementById('todayHistory')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    requestLocation();
    loadTodayHistory();
    
    // Event listeners
    elements.checkInBtn.addEventListener('click', () => handleAttendance('in'));
    elements.checkOutBtn.addEventListener('click', () => handleAttendance('out'));
    elements.pin.addEventListener('input', handlePinInput);
}

// Update date and time
function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    elements.datetime.textContent = now.toLocaleDateString('id-ID', options);
}

// Request geolocation
function requestLocation() {
    if (!navigator.geolocation) {
        updateLocationStatus('error', 'Browser tidak mendukung GPS');
        return;
    }

    updateLocationStatus('checking', 'Memeriksa lokasi...');

    navigator.geolocation.getCurrentPosition(
        handleLocationSuccess,
        handleLocationError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Handle location success
function handleLocationSuccess(position) {
    currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };

    const distance = calculateDistance(
        currentLocation.lat,
        currentLocation.lng,
        CONFIG.CAFE_LOCATION.lat,
        CONFIG.CAFE_LOCATION.lng
    );

    isInRange = distance <= CONFIG.MAX_DISTANCE;

    if (isInRange) {
        updateLocationStatus('in-range', `Anda berada di lokasi kerja (${Math.round(distance)}m)`);
    } else {
        updateLocationStatus('out-range', `Anda terlalu jauh dari lokasi (${Math.round(distance)}m)`);
    }
}

// Handle location error
function handleLocationError(error) {
    let errorMessage = 'Tidak dapat mengakses lokasi';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = 'Izin lokasi ditolak. Mohon aktifkan GPS';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = 'Informasi lokasi tidak tersedia';
            break;
        case error.TIMEOUT:
            errorMessage = 'Permintaan lokasi timeout';
            break;
    }
    
    updateLocationStatus('error', errorMessage);
    isInRange = false;
}

// Update location status UI
function updateLocationStatus(status, text) {
    elements.locationStatus.className = 'location-status ' + status;
    elements.locationStatus.querySelector('.status-text').textContent = text;
}

// Calculate distance between two coordinates (Haversine formula)
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

// Handle PIN input (only numbers)
function handlePinInput(e) {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
}

// Handle attendance (Check In/Out)
async function handleAttendance(type) {
    // Validation
    const baristaId = elements.baristaName.value;
    const pin = elements.pin.value;

    if (!baristaId) {
        showMessage('error', 'Silakan pilih nama barista');
        return;
    }

    if (pin.length !== 4) {
        showMessage('error', 'PIN harus 4 digit');
        return;
    }

    // Verify PIN
    if (BARISTA_DATA[baristaId].pin !== pin) {
        showMessage('error', 'PIN salah!');
        return;
    }

    // Check location
    if (!isInRange) {
        showMessage('error', 'Anda berada di luar radius lokasi kerja (max 50m)');
        return;
    }

    // Disable buttons
    elements.checkInBtn.disabled = true;
    elements.checkOutBtn.disabled = true;

    try {
        // Prepare data
        const attendanceData = {
            timestamp: new Date().toISOString(),
            baristaId: baristaId,
            baristaName: BARISTA_DATA[baristaId].name,
            type: type,
            location: `${currentLocation.lat}, ${currentLocation.lng}`,
            distance: calculateDistance(
                currentLocation.lat,
                currentLocation.lng,
                CONFIG.CAFE_LOCATION.lat,
                CONFIG.CAFE_LOCATION.lng
            )
        };

        // Send to Google Sheets
        await sendToGoogleSheets(attendanceData);

        // Success
        const typeText = type === 'in' ? 'Check In' : 'Check Out';
        showMessage('success', `${typeText} berhasil! Selamat bekerja, ${BARISTA_DATA[baristaId].name}`);

        // Reset form
        elements.baristaName.value = '';
        elements.pin.value = '';

        // Refresh history
        loadTodayHistory();

    } catch (error) {
        showMessage('error', 'Gagal menyimpan presensi: ' + error.message);
    } finally {
        // Enable buttons
        elements.checkInBtn.disabled = false;
        elements.checkOutBtn.disabled = false;
    }
}

// Send data to Google Sheets
async function sendToGoogleSheets(data) {
    // Check if URL is configured
    if (CONFIG.GOOGLE_SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
        console.log('Data yang akan dikirim:', data);
        // Simulate success for testing
        return new Promise(resolve => setTimeout(resolve, 1000));
    }

    const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    });

    // Note: no-cors mode won't return response data
    // We assume success if no error is thrown
    return true;
}

// Load today's attendance history
function loadTodayHistory() {
    // This is a placeholder - in production, fetch from Google Sheets
    const today = new Date().toLocaleDateString('id-ID');
    
    // Example data (replace with actual fetch from Google Sheets)
    const historyData = [
        // { name: 'Ahmad Rizki', type: 'in', time: '08:00:15' },
        // { name: 'Siti Nurhaliza', type: 'in', time: '08:05:30' },
    ];

    if (historyData.length === 0) {
        elements.todayHistory.innerHTML = '<p class="no-data">Belum ada presensi hari ini</p>';
        return;
    }

    let html = '';
    historyData.forEach(item => {
        const typeClass = item.type === 'in' ? 'check-in' : 'check-out';
        const badgeClass = item.type === 'in' ? 'in' : 'out';
        const badgeText = item.type === 'in' ? 'Masuk' : 'Keluar';

        html += `
            <div class="history-item ${typeClass}">
                <div class="history-info">
                    <div class="history-name">${item.name}</div>
                    <div class="history-time">${item.time}</div>
                </div>
                <span class="history-badge ${badgeClass}">${badgeText}</span>
            </div>
        `;
    });

    elements.todayHistory.innerHTML = html;
}

// Show message
function showMessage(type, text) {
    elements.message.className = `message ${type} show`;
    elements.message.textContent = text;

    // Auto hide after 5 seconds
    setTimeout(() => {
        elements.message.classList.remove('show');
    }, 5000);
}