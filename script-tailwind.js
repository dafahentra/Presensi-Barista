const CONFIG = {
    CAFE_LOCATION: {
        lat: -7.770359121073076,
        lng: 110.37955097624653
    },
    MAX_DISTANCE: 100, // meters
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyn7dVAOzBDlaFDdwPCBfw5hd41CVNXAUJka3ylL23DSzs_KQMwLYFEXoso0A7pi_fW7g/exec',
    API_KEY: 'your-secret-api-key-here'
};

// Global state
let currentLocation = null;
let isInRange = false;
let map = null;
let cafeMarker = null;
let userMarker = null;
let radiusCircle = null;

// DOM Elements
const elements = {
    datetime: document.getElementById('datetime'),
    statusBadge: document.getElementById('statusBadge'),
    selectedName: document.getElementById('selectedName'),
    currentShift: document.getElementById('currentShift'),
    currentDate: document.getElementById('currentDate'),
    currentTime: document.getElementById('currentTime'),
    coordinates: document.getElementById('coordinates'),
    radiusStatus: document.getElementById('radiusStatus'),
    baristaName: document.getElementById('baristaName'),
    pin: document.getElementById('pin'),
    attendanceType: document.getElementById('attendanceType'),
    submitBtn: document.getElementById('submitBtn'),
    message: document.getElementById('message'),
    todayHistory: document.getElementById('todayHistory'),
    refreshLocationBtn: document.getElementById('refreshLocationBtn')
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    initMap();
    requestLocation();
    loadTodayHistory();
    
    // Event listeners
    elements.submitBtn.addEventListener('click', handleSubmit);
    elements.pin.addEventListener('input', handlePinInput);
    elements.baristaName.addEventListener('change', updateBaristaInfo);
    elements.refreshLocationBtn.addEventListener('click', handleRefreshLocation);
    
    // Auto refresh
    setInterval(loadTodayHistory, 60000);
    setInterval(requestLocation, 120000);
}

// Update date and time
function updateDateTime() {
    const now = new Date();
    
    // Header datetime
    const datetimeOptions = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    };
    elements.datetime.textContent = now.toLocaleDateString('id-ID', datetimeOptions);
    
    // Info card date
    const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
    elements.currentDate.textContent = now.toLocaleDateString('id-ID', dateOptions);
    
    // Info card time
    elements.currentTime.textContent = now.toLocaleTimeString('id-ID');
    
    // Determine shift
    const hour = now.getHours();
    let shift = '-';
    if (hour >= 7 && hour < 10) shift = 'Shift 1 (07:30 - 10:00)';
    else if (hour >= 10 && hour < 12) shift = 'Shift 2 (10:00 - 12:30)';
    else if (hour >= 12 && hour < 14) shift = 'Shift 3 (12:30 - 14:30)';
    else if (hour >= 14 && hour < 17) shift = 'Shift 4 (14:30 - 17:00)';
    else shift = 'Di luar jam operasional';
    
    elements.currentShift.textContent = shift;
}

// Update barista info when selected
function updateBaristaInfo() {
    const select = elements.baristaName;
    const selectedText = select.options[select.selectedIndex].text;
    elements.selectedName.textContent = selectedText !== '-- Pilih Barista --' ? selectedText : '-';
}

// Initialize Leaflet Map (centered on user location)
function initMap() {
    // Create map centered on cafe initially
    map = L.map('map', {
        center: [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
        zoom: 16,
        zoomControl: true,
        scrollWheelZoom: false
    });

    // Add OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(map);

    // Add cafe marker (smaller, less prominent)
    const cafeIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div class="marker-pin" style="font-size: 24px;">🏪</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });

    cafeMarker = L.marker([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
        icon: cafeIcon,
        title: 'SECTOR SEVEN Cafe'
    }).addTo(map);
    
    cafeMarker.bindPopup('<div class="text-center"><b>SECTOR SEVEN</b><br><span class="text-xs">Lokasi Cafe</span></div>');

    // Add radius circle (more subtle)
    radiusCircle = L.circle([CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng], {
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.08,
        radius: CONFIG.MAX_DISTANCE,
        weight: 2,
        dashArray: '5, 10'
    }).addTo(map);
}

// Update user marker on map (centered and prominent)
function updateUserMarkerOnMap(lat, lng, distance) {
    // Remove old marker if exists
    if (userMarker) {
        map.removeLayer(userMarker);
    }

    const inRange = distance <= CONFIG.MAX_DISTANCE;
    
    // Create prominent user marker
    const userIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div class="marker-pin ${inRange ? 'pulse' : ''}" style="font-size: 40px;">${inRange ? '📍' : '📍'}</div>`,
        iconSize: [50, 50],
        iconAnchor: [25, 50]
    });

    userMarker = L.marker([lat, lng], {
        icon: userIcon,
        title: 'Lokasi Anda'
    }).addTo(map);

    // Popup with status
    const statusEmoji = inRange ? '✅' : '❌';
    const statusText = inRange ? 'Dalam Radius' : 'Di Luar Radius';
    const statusColor = inRange ? '#10b981' : '#ef4444';
    
    userMarker.bindPopup(`
        <div class="text-center">
            <div class="text-2xl mb-1">${statusEmoji}</div>
            <b>Lokasi Anda</b><br>
            <span style="color: ${statusColor}; font-weight: 600;">${statusText}</span><br>
            <span class="text-xs text-gray-600">Jarak: ${Math.round(distance)}m</span>
        </div>
    `).openPopup();

    // Draw line between cafe and user
    if (window.distanceLine) {
        map.removeLayer(window.distanceLine);
    }
    
    window.distanceLine = L.polyline([
        [CONFIG.CAFE_LOCATION.lat, CONFIG.CAFE_LOCATION.lng],
        [lat, lng]
    ], {
        color: inRange ? '#10b981' : '#ef4444',
        weight: 3,
        opacity: 0.6,
        dashArray: '10, 10'
    }).addTo(map);

    // Center map on user location with good zoom
    map.setView([lat, lng], 17, { animate: true });
    
    // Update coordinates display
    elements.coordinates.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    
    // Update radius status
    const statusHTML = inRange 
        ? `<svg class="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
             <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
           </svg>
           <span class="text-green-600 font-medium">Dalam Radius: ${Math.round(distance)} meter</span>`
        : `<svg class="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
             <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
           </svg>
           <span class="text-red-600 font-medium">Di Luar Radius: ${Math.round(distance)} meter</span>`;
    
    elements.radiusStatus.innerHTML = statusHTML;
}

// Request geolocation
function requestLocation() {
    if (!navigator.geolocation) {
        updateStatusBadge('error', 'Browser tidak mendukung GPS');
        return;
    }

    updateStatusBadge('checking', 'Memeriksa lokasi...');

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

    // Update map
    updateUserMarkerOnMap(currentLocation.lat, currentLocation.lng, distance);

    // Update status badge
    if (isInRange) {
        updateStatusBadge('success', 'Dalam Radius - Siap Presensi');
    } else {
        updateStatusBadge('error', 'Di Luar Radius');
    }
}

// Handle location error
function handleLocationError(error) {
    let errorMessage = 'Tidak dapat mengakses lokasi';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = 'Izin lokasi ditolak';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = 'Lokasi tidak tersedia';
            break;
        case error.TIMEOUT:
            errorMessage = 'Request timeout';
            break;
    }
    
    updateStatusBadge('error', errorMessage);
    elements.radiusStatus.innerHTML = '<span class="text-gray-500">Tidak dapat mendeteksi lokasi</span>';
    elements.coordinates.textContent = 'N/A';
    isInRange = false;
}

// Update status badge
function updateStatusBadge(type, text) {
    const badge = elements.statusBadge;
    
    badge.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-medium';
    
    let dotClass = 'w-2 h-2 rounded-full mr-2';
    
    if (type === 'checking') {
        badge.classList.add('bg-gray-100', 'text-gray-600');
        dotClass += ' bg-gray-400 animate-pulse';
    } else if (type === 'success') {
        badge.classList.add('bg-green-100', 'text-green-700');
        dotClass += ' bg-green-500';
    } else if (type === 'error') {
        badge.classList.add('bg-red-100', 'text-red-700');
        dotClass += ' bg-red-500';
    }
    
    badge.innerHTML = `<span class="${dotClass}"></span>${text}`;
}

// Calculate distance
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

// Handle refresh location
function handleRefreshLocation() {
    const btn = elements.refreshLocationBtn;
    btn.classList.add('animate-spin');
    requestLocation();
    setTimeout(() => {
        btn.classList.remove('animate-spin');
    }, 1000);
}

// Handle submit
async function handleSubmit() {
    const baristaId = elements.baristaName.value;
    const pin = elements.pin.value;
    const type = elements.attendanceType.value;

    // Validation
    if (!baristaId) {
        showMessage('error', 'Silakan pilih nama barista');
        return;
    }

    if (pin.length !== 4) {
        showMessage('error', 'PIN harus 4 digit');
        return;
    }

    // Re-verify location
    showMessage('info', 'Memverifikasi lokasi...');
    
    try {
        await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    handleLocationSuccess(position);
                    resolve();
                },
                reject,
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        });
    } catch (error) {
        showMessage('error', 'Gagal memverifikasi lokasi. Pastikan GPS aktif.');
        return;
    }

    if (!isInRange) {
        showMessage('error', 'Anda berada di luar radius lokasi kerja (max 100m)');
        return;
    }

    // Disable button
    elements.submitBtn.disabled = true;
    elements.submitBtn.innerHTML = `
        <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Mengirim...
    `;

    try {
        const attendanceData = {
            apiKey: CONFIG.API_KEY,
            timestamp: new Date().toISOString(),
            baristaId: baristaId,
            pin: pin,
            type: type,
            location: `${currentLocation.lat}, ${currentLocation.lng}`,
            distance: calculateDistance(
                currentLocation.lat,
                currentLocation.lng,
                CONFIG.CAFE_LOCATION.lat,
                CONFIG.CAFE_LOCATION.lng
            )
        };

        const result = await sendToGoogleSheets(attendanceData);

        if (!result.success) {
            throw new Error(result.message || 'Gagal menyimpan presensi');
        }

        const typeText = type === 'in' ? 'Check In' : 'Check Out';
        const baristaName = result.baristaName || 'Barista';
        showMessage('success', `✓ ${typeText} berhasil! ${type === 'in' ? 'Selamat bekerja' : 'Terima kasih'}, ${baristaName}!`);

        // Reset form
        elements.baristaName.value = '';
        elements.pin.value = '';
        elements.selectedName.textContent = '-';

        setTimeout(() => {
            loadTodayHistory();
        }, 2000);

    } catch (error) {
        console.error('Attendance error:', error);
        showMessage('error', '✗ ' + error.message);
    } finally {
        elements.submitBtn.disabled = false;
        elements.submitBtn.innerHTML = `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
            Submit Presensi
        `;
    }
}

// Send to Google Sheets
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
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Tidak ada koneksi internet');
        }
        throw error;
    }
}

// Load today's history
async function loadTodayHistory() {
    elements.todayHistory.innerHTML = `
        <div class="text-center text-gray-400 py-8 text-sm">
            <svg class="w-8 h-8 mx-auto mb-2 opacity-50 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Memuat...
        </div>
    `;
    
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getHistory`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            displayHistory(result.data);
        } else {
            elements.todayHistory.innerHTML = `
                <div class="text-center text-gray-400 py-8 text-sm">
                    <svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    Belum ada presensi hari ini
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading history:', error);
        elements.todayHistory.innerHTML = `
            <div class="text-center text-red-500 py-8 text-sm">
                <svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Gagal memuat: ${error.message}
            </div>
        `;
    }
}

// Display history
function displayHistory(data) {
    let html = '';
    
    data.forEach(item => {
        const isCheckIn = item.type === 'in';
        const bgColor = isCheckIn ? 'bg-green-50' : 'bg-red-50';
        const borderColor = isCheckIn ? 'border-l-green-500' : 'border-l-red-500';
        const badgeColor = isCheckIn ? 'bg-green-500' : 'bg-red-500';
        const badgeText = isCheckIn ? 'Masuk' : 'Keluar';

        html += `
            <div class="${bgColor} ${borderColor} border-l-4 rounded-lg p-3 flex items-center justify-between hover:shadow-md transition-shadow">
                <div>
                    <div class="font-semibold text-gray-800">${item.name}</div>
                    <div class="text-sm text-gray-600">${item.waktu}</div>
                </div>
                <span class="${badgeColor} text-white text-xs font-semibold px-3 py-1 rounded-full">
                    ${badgeText}
                </span>
            </div>
        `;
    });

    elements.todayHistory.innerHTML = html;
}

// Show message
function showMessage(type, text) {
    const message = elements.message;
    message.className = 'mt-4 p-4 rounded-xl text-sm font-medium';
    
    if (type === 'success') {
        message.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-300');
    } else if (type === 'error') {
        message.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-300');
    } else if (type === 'info') {
        message.classList.add('bg-blue-100', 'text-blue-700', 'border', 'border-blue-300');
    }
    
    message.textContent = text;
    message.classList.remove('hidden');

    setTimeout(() => {
        message.classList.add('hidden');
    }, 5000);
}

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});