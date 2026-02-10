const CONFIG = {
    CAFE_LOCATION: {
        // ⚠️ HARUS SAMA dengan backend!
        lat: -7.770132025075595,
        lng: 110.3799652041438
    },
    MAX_DISTANCE: 100, // meters
    // ⚠️ GANTI dengan URL deployment Apps Script Anda yang BARU
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw_770_iqIlOcmfX0PnZGK_5wpy9PA-7jPs6InTuTQGeAWTP3Eh6XIAo9V-5Vpal1eDWA/exec'
};

// Global state
let currentLocation = null;
let isInRange = false;
let baristaList = {}; // Akan diload dari backend

// Map variables
let map = null;
let cafeMarker = null;
let userMarker = null;
let radiusCircle = null;

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
    latValue: document.getElementById('latValue'),
    lngValue: document.getElementById('lngValue'),
    radiusStatus: document.getElementById('radiusStatus'),
    radiusText: document.getElementById('radiusText')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
    console.log('🚀 Initializing app...');
    console.log('📍 Protocol:', window.location.protocol);
    
    // Check HTTPS
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.warn('⚠️ WARNING: Not using HTTPS! GPS may not work.');
        showMessage('error', 'Website harus menggunakan HTTPS untuk akses GPS!');
    }
    
    updateDateTime();
    setInterval(updateDateTime, 60000); // Update every 1 minute
    initMap();
    requestLocation();
    
    // Load barista list dari backend
    loadBaristaList();
    
    // Load today's history
    loadTodayHistory();
    
    // Event listeners
    elements.checkInBtn.addEventListener('click', () => handleAttendance('in'));
    elements.checkOutBtn.addEventListener('click', () => handleAttendance('out'));
    elements.pin.addEventListener('input', handlePinInput);
    
    // Refresh history every 1 minute
    setInterval(loadTodayHistory, 60000);
}

// ✅ Load barista list dari backend (TANPA PIN)
async function loadBaristaList() {
    console.log('📋 Loading barista list from backend...');
    
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getBaristaList`);
        
        if (!response.ok) {
            throw new Error('Failed to load barista list');
        }
        
        const result = await response.json();
        console.log('Barista list response:', result);
        
        if (result.success && result.data) {
            baristaList = result.data;
            populateBaristaDropdown();
        } else {
            console.error('Failed to load barista list:', result.message);
        }
    } catch (error) {
        console.error('❌ Error loading barista list:', error);
        // Fallback: populate dengan data manual
        populateBaristaDropdownFallback();
    }
}

// Populate dropdown dari backend data
function populateBaristaDropdown() {
    const select = elements.baristaName;
    select.innerHTML = '<option value="">-- Pilih Barista --</option>';
    
    Object.entries(baristaList).forEach(([id, data]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = data.name;
        select.appendChild(option);
    });
    
    console.log('✅ Barista dropdown populated from backend');
}

// Fallback jika backend gagal
function populateBaristaDropdownFallback() {
    console.log('⚠️ Using fallback barista list');
    // Dropdown sudah ada di HTML, tidak perlu populate
}

// Initialize map
function initMap() {
    console.log('🗺️ Initializing map...');
    
    try {
        if (typeof L === 'undefined') {
            console.error('❌ Leaflet library not loaded!');
            showMessage('error', 'Map library gagal dimuat. Refresh halaman.');
            return;
        }
        
        map = L.map('map', {
            center: [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
            zoom: 17,
            zoomControl: true,
            scrollWheelZoom: false
        });
        
        console.log('✅ Map created');

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19
        }).addTo(map);

        const cafeIcon = L.divIcon({
            className: 'custom-cafe-marker',
            html: '<div style="background-color: #333; width: 30px; height: 30px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"><div style="background-color: white; width: 10px; height: 10px; border-radius: 50%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(45deg);"></div></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });

        cafeMarker = L.marker([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
            icon: cafeIcon
        }).addTo(map);
        
        cafeMarker.bindPopup('<b>SECTOR SEVEN</b><br>Lokasi Cafe').openPopup();

        radiusCircle = L.circle([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
            color: '#4CAF50',
            fillColor: '#4CAF50',
            fillOpacity: 0.15,
            radius: CONFIG.MAX_DISTANCE,
            weight: 2,
            dashArray: '5, 5'
        }).addTo(map);

        radiusCircle.bindPopup(`Area kerja (radius ${CONFIG.MAX_DISTANCE}m)`);
        
        console.log('✅ Map initialized');
        
    } catch (error) {
        console.error('❌ Map error:', error);
    }
}

// Update map with user location
function updateMapUserLocation(lat, lng, inRange) {
    if (!map) return;
    
    try {
        if (userMarker) {
            map.removeLayer(userMarker);
        }

        const markerColor = inRange ? '#2196F3' : '#f44336';
        const userIcon = L.divIcon({
            className: 'custom-user-marker',
            html: `<div style="background-color: ${markerColor}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        userMarker = L.marker([lat, lng], {
            icon: userIcon
        }).addTo(map);

        const distance = calculateDistance(lat, lng, CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng);
        const statusText = inRange ? 'Dalam area kerja' : 'Di luar area kerja';
        userMarker.bindPopup(`<b>Lokasi Anda</b><br>${statusText}<br>Jarak: ${Math.round(distance)}m`);

        const bounds = L.latLngBounds([
            [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
            [lat, lng]
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });
        
    } catch (error) {
        console.error('❌ Error updating map:', error);
    }
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
    console.log('📍 Requesting location...');
    
    if (!navigator.geolocation) {
        updateLocationStatus('error', 'Browser tidak mendukung GPS');
        return;
    }

    updateLocationStatus('checking', 'Memeriksa lokasi...');

    navigator.geolocation.getCurrentPosition(
        handleLocationSuccess,
        handleLocationError,
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
}

// Handle location success
function handleLocationSuccess(position) {
    currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };
    
    console.log('✅ Location obtained:', currentLocation);

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

    updateMapUserLocation(currentLocation.lat, currentLocation.lng, isInRange);
    updateCoordinatesDisplay(currentLocation.lat, currentLocation.lng, distance, isInRange);
}

// Update coordinates display
function updateCoordinatesDisplay(lat, lng, distance, inRange) {
    if (elements.latValue) {
        elements.latValue.textContent = lat.toFixed(6);
    }
    if (elements.lngValue) {
        elements.lngValue.textContent = lng.toFixed(6);
    }
    
    if (elements.radiusStatus && elements.radiusText) {
        if (inRange) {
            elements.radiusStatus.className = 'radius-status in-range';
            elements.radiusText.textContent = `Dalam Radius: ${Math.round(distance)} meter`;
        } else {
            elements.radiusStatus.className = 'radius-status out-range';
            elements.radiusText.textContent = `Di Luar Radius: ${Math.round(distance)} meter`;
        }
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
    
    console.error('❌ Location error:', errorMessage);
    updateLocationStatus('error', errorMessage);
    isInRange = false;
    
    if (elements.radiusStatus && elements.radiusText) {
        elements.radiusStatus.className = 'radius-status error';
        elements.radiusText.textContent = errorMessage;
    }
}

// Update location status UI
function updateLocationStatus(status, text) {
    elements.locationStatus.className = 'location-status ' + status;
    elements.locationStatus.querySelector('.status-text').textContent = text;
}

// Calculate distance (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// Handle PIN input
function handlePinInput(e) {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
}

// ✅ Handle attendance - SEND KE BACKEND UNTUK VALIDASI
async function handleAttendance(type) {
    console.log(`📝 Attempting ${type === 'in' ? 'check-in' : 'check-out'}...`);
    
    const baristaId = elements.baristaName.value;
    const pin = elements.pin.value;

    // Basic validation
    if (!baristaId) {
        showMessage('error', 'Silakan pilih nama barista');
        return;
    }

    if (pin.length !== 4) {
        showMessage('error', 'PIN harus 4 digit');
        return;
    }

    if (!currentLocation) {
        showMessage('error', 'Lokasi belum terdeteksi');
        return;
    }

    if (!isInRange) {
        showMessage('error', 'Anda berada di luar radius lokasi kerja');
        return;
    }

    // Disable buttons
    elements.checkInBtn.disabled = true;
    elements.checkOutBtn.disabled = true;

    try {
        // ✅ KIRIM KE BACKEND UNTUK VALIDASI PIN & LOKASI
        const attendanceData = {
            action: 'attendance',
            timestamp: new Date().toISOString(),
            baristaId: baristaId,
            pin: pin, // Backend akan validasi
            type: type,
            latitude: currentLocation.lat,
            longitude: currentLocation.lng
        };

        console.log('📤 Sending to backend:', attendanceData);

        // ✅ HAPUS mode: 'no-cors' agar bisa baca response!
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(attendanceData)
        });

        console.log('📥 Response status:', response.status);

        const result = await response.json();
        console.log('📥 Response data:', result);

        if (result.success) {
            showMessage('success', result.message);
            elements.baristaName.value = '';
            elements.pin.value = '';
            
            setTimeout(() => {
                loadTodayHistory();
            }, 2000);
        } else {
            showMessage('error', result.message);
        }

    } catch (error) {
        console.error('❌ Attendance error:', error);
        showMessage('error', 'Gagal menyimpan presensi. Cek console untuk detail.');
    } finally {
        elements.checkInBtn.disabled = false;
        elements.checkOutBtn.disabled = false;
    }
}

// Load history
async function loadTodayHistory() {
    console.log('📋 Loading history...');
    
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getHistory`);
        
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
        console.error('❌ Error loading history:', error);
        elements.todayHistory.innerHTML = '<p class="no-data">Gagal memuat riwayat</p>';
    }
}

// Display history
function displayHistory(data) {
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

    setTimeout(() => {
        elements.message.classList.remove('show');
    }, 5000);
}