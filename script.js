const CONFIG = {
    CAFE_LOCATION: {
        lat: -7.78354905965938,
        lng: 110.40493138658327 
    },
    MAX_DISTANCE: 100, // meters
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyn7dVAOzBDlaFDdwPCBfw5hd41CVNXAUJka3ylL23DSzs_KQMwLYFEXoso0A7pi_fW7g/exec',
    API_KEY: 'f7e3d8c9b2a1e6d4f5a8b3c7e9d2f6a4b8c5e7d9f3a6b8c2e5d7f9a3b6c8e4' // Ganti dengan API key Anda di Apps Script
};

// Global state
let currentLocation = null;
let isInRange = false;
let durationInterval = null;
let map = null;
let cafeMarker = null;
let userMarker = null;
let radiusCircle = null;
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
    circleProgress: document.getElementById('circleProgress'),
    refreshLocationBtn: document.getElementById('refreshLocationBtn')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    // Initialize map
    initMap();
    
    // Request location
    requestLocation();
    
    // Load today's history
    loadTodayHistory();
    
    // Event listeners
    elements.checkInBtn.addEventListener('click', () => handleAttendance('in'));
    elements.checkOutBtn.addEventListener('click', () => handleAttendance('out'));
    elements.pin.addEventListener('input', handlePinInput);
    elements.refreshLocationBtn.addEventListener('click', () => {
        elements.refreshLocationBtn.classList.add('spinning');
        requestLocation();
        setTimeout(() => {
            elements.refreshLocationBtn.classList.remove('spinning');
        }, 1000);
    });
    
    // Refresh history every minute
    setInterval(loadTodayHistory, 60000);
    
    // Re-check location every 2 minutes
    setInterval(requestLocation, 120000);
}

// Initialize Leaflet Map
function initMap() {
    // Create map centered on cafe location
    map = L.map('map', {
        center: [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
        zoom: 17,
        zoomControl: true,
        scrollWheelZoom: false
    });

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // Add cafe marker (red)
    const cafeIcon = L.divIcon({
        className: 'custom-cafe-marker',
        html: '<div class="marker-pin cafe-pin">📍</div>',
        iconSize: [40, 40],
        iconAnchor: [20, 40]
    });

    cafeMarker = L.marker([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
        icon: cafeIcon,
        title: 'SECTOR SEVEN Cafe'
    }).addTo(map);
    
    cafeMarker.bindPopup('<b>SECTOR SEVEN</b><br>Lokasi Cafe').openPopup();

    // Add 100m radius circle
    radiusCircle = L.circle([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
        color: '#4CAF50',
        fillColor: '#4CAF50',
        fillOpacity: 0.1,
        radius: CONFIG.MAX_DISTANCE,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(map);

    // Fit map to show radius
    map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });
}

// Update user marker on map
function updateUserMarkerOnMap(lat, lng, distance) {
    // Remove old marker if exists
    if (userMarker) {
        map.removeLayer(userMarker);
    }

    // Determine color based on distance
    const inRange = distance <= CONFIG.MAX_DISTANCE;
    const markerColor = inRange ? '✅' : '❌';

    // Create user marker
    const userIcon = L.divIcon({
        className: 'custom-user-marker',
        html: `<div class="marker-pin user-pin ${inRange ? 'in-range' : 'out-range'}">${markerColor}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
    });

    userMarker = L.marker([lat, lng], {
        icon: userIcon,
        title: 'Lokasi Anda'
    }).addTo(map);

    const statusText = inRange ? 'Dalam jangkauan ✓' : 'Di luar jangkauan ✗';
    userMarker.bindPopup(`<b>Lokasi Anda</b><br>${statusText}<br>Jarak: ${Math.round(distance)}m`);

    // Draw line between cafe and user
    if (window.distanceLine) {
        map.removeLayer(window.distanceLine);
    }
    
    window.distanceLine = L.polyline([
        [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
        [lat, lng]
    ], {
        color: inRange ? '#4CAF50' : '#f44336',
        weight: 2,
        opacity: 0.7,
        dashArray: '10, 10'
    }).addTo(map);

    // Fit bounds to show both markers
    const bounds = L.latLngBounds([
        [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
        [lat, lng]
    ]);
    map.fitBounds(bounds, { padding: [50, 50] });
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

// Promise version for re-verification
function requestLocationPromise() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Browser tidak mendukung GPS'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                handleLocationSuccess(position);
                resolve(position);
            },
            (error) => {
                handleLocationError(error);
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
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

    // Update map
    updateUserMarkerOnMap(currentLocation.lat, currentLocation.lng, distance);

    // Update status
    if (isInRange) {
        updateLocationStatus('in-range', `✓ Anda berada di lokasi kerja (${Math.round(distance)}m)`);
    } else {
        updateLocationStatus('out-range', `✗ Anda terlalu jauh dari lokasi (${Math.round(distance)}m)`);
    }
}

// Handle location error
function handleLocationError(error) {
    let errorMessage = 'Tidak dapat mengakses lokasi';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = '❌ Izin lokasi ditolak. Mohon aktifkan GPS';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = '❌ Informasi lokasi tidak tersedia';
            break;
        case error.TIMEOUT:
            errorMessage = '❌ Permintaan lokasi timeout';
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

    // Re-verify location before submitting
    showMessage('info', 'Memverifikasi lokasi...');
    
    try {
        await requestLocationPromise();
    } catch (error) {
        showMessage('error', 'Gagal memverifikasi lokasi. Pastikan GPS aktif.');
        return;
    }

    // Check location
    if (!isInRange) {
        showMessage('error', 'Anda berada di luar radius lokasi kerja (max 100m)');
        return;
    }

    // Disable buttons
    elements.checkInBtn.disabled = true;
    elements.checkOutBtn.disabled = true;

    try {
        // Prepare data (PIN will be validated server-side)
        const attendanceData = {
            apiKey: CONFIG.API_KEY,
            timestamp: new Date().toISOString(),
            baristaId: baristaId,
            pin: pin, // Server will validate this
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
        const result = await sendToGoogleSheets(attendanceData);

        if (!result.success) {
            throw new Error(result.message || 'Gagal menyimpan presensi');
        }

        // Success
        const baristaName = result.baristaName || 'Barista';
        const typeText = type === 'in' ? 'Check In' : 'Check Out';
        showMessage('success', `✓ ${typeText} berhasil! ${type === 'in' ? 'Selamat bekerja' : 'Terima kasih'}, ${baristaName}`);

        // Reset form
        elements.baristaName.value = '';
        elements.pin.value = '';

        // Refresh history after a short delay
        setTimeout(() => {
            loadTodayHistory();
        }, 2000);

    } catch (error) {
        console.error('Attendance error:', error);
        showMessage('error', '✗ Gagal menyimpan presensi: ' + error.message);
    } finally {
        // Enable buttons
        elements.checkInBtn.disabled = false;
        elements.checkOutBtn.disabled = false;
    }
}

// Send data to Google Sheets
async function sendToGoogleSheets(data) {
    try {
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        
        if (result.error === 'INVALID_PIN') {
            throw new Error('PIN salah!');
        }
        
        if (result.error === 'UNAUTHORIZED') {
            throw new Error('Akses tidak sah');
        }

        return result;

    } catch (error) {
        console.error('Send to sheets error:', error);
        
        // Handle network errors
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Tidak ada koneksi internet');
        }
        
        throw error;
    }
}

// Load today's attendance history
async function loadTodayHistory() {
    console.log('Loading history...');
    
    elements.todayHistory.innerHTML = '<p class="no-data">⏳ Memuat...</p>';
    
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getHistory`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
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
        elements.todayHistory.innerHTML = 
            `<p class="no-data error-text">❌ Gagal memuat riwayat: ${error.message}</p>`;
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

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    showMessage('error', 'Terjadi kesalahan sistem. Mohon refresh halaman.');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});