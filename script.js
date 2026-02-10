const CONFIG = {
    CAFE_LOCATION: {
        lat: -7.770132025075595,
        lng: 110.3799652041438
    },
    MAX_DISTANCE: 100, // meters
    // ⚠️ GANTI URL INI DENGAN URL DEPLOYMENT BARU ANDA!
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwpRtLg3zSx2sL_rdFpN8P8QtXI_O8cv0HQnnxUze2ej3viiucc69u7BIDEBt6YVJqJoA/exec'
};

const BARISTA_DATA = {
    '1': { name: 'Abida', pin: '4927' },
    '2': { name: 'Aca', pin: '8153' },
    '3': { name: 'Rilies', pin: '3030' },
    '4': { name: 'Rio', pin: '1708' },
    '5': { name: 'Taqiy', pin: '9111' },
    '6': { name: 'Salma', pin: '2512' },
    '7': { name: 'Ibriel', pin: '1397' },
    '8': { name: 'Abey', pin: '2580' },
    '9': { name: 'Claresta', pin: '1473' },
    '10': { name: 'Dafa', pin: '2809' },
    '11': { name: 'Devon', pin: '5288' },
    '12': { name: 'Intan', pin: '4462' }
};

// Global state
let currentLocation = null;
let isInRange = false;
let durationInterval = null;
let todayAttendance = {
    checkIn: null,
    checkOut: null
};

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
    durationCard: document.getElementById('durationCard'),
    durationTime: document.getElementById('durationTime'),
    checkInTime: document.getElementById('checkInTime'),
    checkOutTime: document.getElementById('checkOutTime'),
    checkOutStatus: document.getElementById('checkOutStatus'),
    circleProgress: document.getElementById('circleProgress'),
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
    console.log('🗺️ Leaflet available:', typeof L !== 'undefined');
    
    // Check HTTPS
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        console.warn('⚠️ WARNING: Not using HTTPS! GPS may not work.');
        showMessage('error', 'Website harus menggunakan HTTPS untuk akses GPS!');
    }
    
    updateDateTime();
    setInterval(updateDateTime, 1000);
    initMap();
    requestLocation();
    loadTodayHistory();
    
    // Event listeners
    elements.checkInBtn.addEventListener('click', () => handleAttendance('in'));
    elements.checkOutBtn.addEventListener('click', () => handleAttendance('out'));
    elements.pin.addEventListener('input', handlePinInput);
    
    // Refresh history every 30 seconds
    setInterval(loadTodayHistory, 30000);
}

// Initialize map
function initMap() {
    console.log('🗺️ Initializing map...');
    
    try {
        // Check if Leaflet is loaded
        if (typeof L === 'undefined') {
            console.error('❌ Leaflet library not loaded!');
            showMessage('error', 'Map library gagal dimuat. Refresh halaman.');
            return;
        }
        
        // Create map centered on cafe location
        map = L.map('map', {
            center: [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
            zoom: 17,
            zoomControl: true,
            scrollWheelZoom: false
        });
        
        console.log('✅ Map object created');

        // Add tile layer (OpenStreetMap)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19
        }).addTo(map);
        
        console.log('✅ Map tiles loaded');

        // Add cafe marker (red marker)
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
        
        console.log('✅ Cafe marker added');

        // Add radius circle (100m)
        radiusCircle = L.circle([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
            color: '#4CAF50',
            fillColor: '#4CAF50',
            fillOpacity: 0.15,
            radius: CONFIG.MAX_DISTANCE,
            weight: 2,
            dashArray: '5, 5'
        }).addTo(map);

        radiusCircle.bindPopup(`Area kerja (radius ${CONFIG.MAX_DISTANCE}m)`);
        
        console.log('✅ Map initialization complete');
        
    } catch (error) {
        console.error('❌ Map initialization error:', error);
        showMessage('error', 'Gagal memuat peta: ' + error.message);
    }
}

// Update map with user location
function updateMapUserLocation(lat, lng, inRange) {
    if (!map) {
        console.error('❌ Map not initialized yet');
        return;
    }
    
    try {
        // Remove old user marker if exists
        if (userMarker) {
            map.removeLayer(userMarker);
        }

        // Create user marker icon (blue for in range, red for out of range)
        const markerColor = inRange ? '#2196F3' : '#f44336';
        const userIcon = L.divIcon({
            className: 'custom-user-marker',
            html: `<div style="background-color: ${markerColor}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });

        // Add user marker
        userMarker = L.marker([lat, lng], {
            icon: userIcon
        }).addTo(map);

        const distance = calculateDistance(lat, lng, CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng);
        const statusText = inRange ? 'Dalam area kerja' : 'Di luar area kerja';
        userMarker.bindPopup(`<b>Lokasi Anda</b><br>${statusText}<br>Jarak: ${Math.round(distance)}m`);

        // Fit bounds to show both markers
        const bounds = L.latLngBounds([
            [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
            [lat, lng]
        ]);
        map.fitBounds(bounds, { padding: [50, 50] });
        
        console.log('✅ User location marker updated');
        
    } catch (error) {
        console.error('❌ Error updating user location on map:', error);
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
    console.log('📍 Requesting geolocation...');
    console.log('Navigator.geolocation:', navigator.geolocation);
    console.log('Current protocol:', window.location.protocol);
    
    if (!navigator.geolocation) {
        console.error('❌ Geolocation not supported');
        updateLocationStatus('error', 'Browser tidak mendukung GPS');
        return;
    }

    updateLocationStatus('checking', 'Memeriksa lokasi...');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            console.log('✅ Location obtained:', position);
            handleLocationSuccess(position);
        },
        (error) => {
            console.error('❌ Location error:', error);
            handleLocationError(error);
        },
        { 
            enableHighAccuracy: true, 
            timeout: 30000,  // Increased timeout
            maximumAge: 0 
        }
    );
}

// Handle location success
function handleLocationSuccess(position) {
    currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };
    
    console.log('📍 Current location:', currentLocation);

    const distance = calculateDistance(
        currentLocation.lat,
        currentLocation.lng,
        CONFIG.CAFE_LOCATION.lat,
        CONFIG.CAFE_LOCATION.lng
    );
    
    console.log('📏 Distance from cafe:', Math.round(distance), 'meters');

    isInRange = distance <= CONFIG.MAX_DISTANCE;

    if (isInRange) {
        updateLocationStatus('in-range', `Anda berada di lokasi kerja (${Math.round(distance)}m)`);
    } else {
        updateLocationStatus('out-range', `Anda terlalu jauh dari lokasi (${Math.round(distance)}m)`);
    }

    // Update map with user location
    updateMapUserLocation(currentLocation.lat, currentLocation.lng, isInRange);
    
    // Update coordinates and radius status display
    updateCoordinatesDisplay(currentLocation.lat, currentLocation.lng, distance, isInRange);
}

// Update coordinates display and radius status
function updateCoordinatesDisplay(lat, lng, distance, inRange) {
    // Update coordinates
    if (elements.latValue) {
        elements.latValue.textContent = lat.toFixed(6);
    }
    if (elements.lngValue) {
        elements.lngValue.textContent = lng.toFixed(6);
    }
    
    // Update radius status
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
    
    console.error('Location error code:', error.code);
    console.error('Location error message:', error.message);
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = 'Izin lokasi ditolak. Mohon aktifkan GPS';
            console.error('❌ User denied location permission');
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = 'Informasi lokasi tidak tersedia';
            console.error('❌ Location information unavailable');
            break;
        case error.TIMEOUT:
            errorMessage = 'Permintaan lokasi timeout. Coba lagi.';
            console.error('❌ Location request timed out');
            break;
    }
    
    updateLocationStatus('error', errorMessage);
    isInRange = false;
    
    // Update radius status
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
    console.log(`📝 Attempting ${type === 'in' ? 'check-in' : 'check-out'}...`);
    
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
        showMessage('error', 'Anda berada di luar radius lokasi kerja');
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

        console.log('📤 Sending to backend:', attendanceData);

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
        console.error('❌ Attendance error:', error);
        showMessage('error', 'Gagal menyimpan presensi: ' + error.message);
    } finally {
        // Enable buttons
        elements.checkInBtn.disabled = false;
        elements.checkOutBtn.disabled = false;
    }
}

// Send data to Google Sheets
async function sendToGoogleSheets(data) {
    console.log('📡 Sending to Google Sheets...');
    
    try {
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        console.log('✅ Data sent (no-cors mode, cannot verify response)');
        // Note: no-cors mode won't return response data
        // We assume success if no error is thrown
        return true;
        
    } catch (error) {
        console.error('❌ Failed to send to Google Sheets:', error);
        throw error;
    }
}

// Load today's attendance history
async function loadTodayHistory() {
    console.log('📋 Loading history...');
    
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getHistory`);
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        
        const result = await response.json();
        console.log('✅ History data received:', result);

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
    console.log('📊 Displaying', data.length, 'history items');
    
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