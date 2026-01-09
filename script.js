const CONFIG = {
    CAFE_LOCATION: {
        lat: -7.770359121073076,
        lng: 110.37955097624653
    },
    MAX_DISTANCE: 100, // meters
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyn7dVAOzBDlaFDdwPCBfw5hd41CVNXAUJka3ylL23DSzs_KQMwLYFEXoso0A7pi_fW7g/exec'
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
let durationInterval = null;
let todayAttendance = {
    checkIn: null,
    checkOut: null
};

// DOM Elements
const elements = {
    datetime: document.getElementById('datetime'),
    locationStatus: document.getElementById('locationStatus'),
    baristaName: document.getElementById('baristaName'),
    pin: document.getElementById('pin'),
    checkInBtn: document.getElementById('checkInBtn'),
    checkOutBtn: document.getElementById('checkOutBtn'),
    message: document.getElementById('message'),
    todayHistory: document.getElementById('todayHistory'),
    durationCard: document.getElementById('durationCard'),
    durationTime: document.getElementById('durationTime'),
    checkInTime: document.getElementById('checkInTime'),
    checkOutTime: document.getElementById('checkOutTime'),
    checkOutStatus: document.getElementById('checkOutStatus'),
    circleProgress: document.getElementById('circleProgress')
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
    
    // Refresh history every 30 seconds
    setInterval(loadTodayHistory, 30000);
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
        showMessage('success', `${typeText} berhasil! ${type === 'in' ? 'Selamat bekerja' : 'Terima kasih'}, ${BARISTA_DATA[baristaId].name}`);

        // Reset form
        elements.baristaName.value = '';
        elements.pin.value = '';

        // Refresh history after a short delay
        setTimeout(() => {
            loadTodayHistory();
        }, 2000);

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
async function loadTodayHistory() {
    console.log('Loading history...');
    
    try {
        // IMPORTANT: Remove mode: 'no-cors' for GET requests
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getHistory`);
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const result = await response.json();
        console.log('History data:', result);

        if (result.success && result.data && result.data.length > 0) {
            displayHistory(result.data);
        } else {
            elements.todayHistory.innerHTML = '<p class="no-data">Belum ada presensi hari ini</p>';
        }
    } catch (error) {
        console.error('Error loading history:', error);
        elements.todayHistory.innerHTML = '<p class="no-data">Gagal memuat riwayat. Cek console untuk detail.</p>';
    }
}

// Display history
function displayHistory(data) {
    console.log('Displaying history:', data);
    
    let html = '';
    data.forEach(item => {
        const typeClass = item.type === 'in' ? 'check-in' : 'check-out';
        const badgeClass = item.type === 'in' ? 'in' : 'out';
        const badgeText = item.type === 'in' ? 'Masuk' : 'Keluar';

        html += `
            <div class="history-item ${typeClass}">
                <div class="history-info">
                    <div class="history-name">${item.name}</div>
                    <div class="history-time">${item.waktu}</div>
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