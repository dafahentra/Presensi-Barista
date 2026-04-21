// ================================
// KONFIGURASI
// ================================
const CONFIG = {
    GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxGmPqmQplPWsfBOJy_K1tQzGP7un19Dme3VSV59mWvKPJvFqg9AEwKhJFMmtbsH6ksQg/exec',
    BARISTA_REFRESH_INTERVAL: 30000,  // 30 detik (sync langsung dari sheet)
    HISTORY_REFRESH_INTERVAL: 15000   // 15 detik
};

// Lokasi cafe & radius dimuat dari backend (single source of truth)
let CAFE_LOCATION = null;
let MAX_DISTANCE = null;

// ================================
// GLOBAL STATE
// ================================
let currentLocation = null;
let isInRange = false;

// Map variables
let map = null;
let cafeMarker = null;
let userMarker = null;
let radiusCircle = null;

// ================================
// DOM ELEMENTS
// ================================
const elements = {
    datetime:       document.getElementById('datetime'),
    baristaName:    document.getElementById('baristaName'),
    pin:            document.getElementById('pin'),
    checkInBtn:     document.getElementById('checkInBtn'),
    checkOutBtn:    document.getElementById('checkOutBtn'),
    message:        document.getElementById('message'),
    todayHistory:   document.getElementById('todayHistory'),
    latValue:       document.getElementById('latValue'),
    lngValue:       document.getElementById('lngValue'),
    radiusStatus:   document.getElementById('radiusStatus'),
    radiusText:     document.getElementById('radiusText')
};

// ================================
// INIT
// ================================
document.addEventListener('DOMContentLoaded', init);

async function init() {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    initMap();

    // Jalankan config (sekaligus barista list) dan geolocation secara paralel
    await Promise.all([
        loadConfigAndBarista(),
        startGeolocation()
    ]);

    loadTodayHistory();

    elements.checkInBtn.addEventListener('click', () => handleAttendance('in'));
    elements.checkOutBtn.addEventListener('click', () => handleAttendance('out'));
    elements.pin.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });

    // Auto-refresh: barista list dan history (sinkron perubahan dari sheet)
    setInterval(refreshBaristaList, CONFIG.BARISTA_REFRESH_INTERVAL);
    setInterval(loadTodayHistory, CONFIG.HISTORY_REFRESH_INTERVAL);

    // Admin panel
    initAdmin();
}

// ================================
// CONFIG + BARISTA LIST (1 Request, Single Source of Truth)
// ================================
async function loadConfigAndBarista() {
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getConfig`);
        if (!response.ok) throw new Error('Network error');

        const result = await response.json();
        if (result.success && result.data) {
            CAFE_LOCATION = result.data.cafeLocation;
            MAX_DISTANCE  = result.data.maxDistance;
            updateMapCafeMarker();

            // Populate barista langsung dari response yang sama (tidak perlu request terpisah)
            if (result.data.baristaList) {
                populateBaristaSelect(result.data.baristaList);
            }
        } else {
            console.error('Gagal memuat konfigurasi:', result.message);
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

// Refresh barista list saja (untuk sinkron perubahan dari sheet)
async function refreshBaristaList() {
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getBaristaList`);
        if (!response.ok) throw new Error('Network error');

        const result = await response.json();
        if (result.success && result.data) {
            populateBaristaSelect(result.data);
        }
    } catch (error) {
        console.error('Error refreshing barista list:', error);
    }
}

function populateBaristaSelect(baristaList) {
    // Populate presensi dropdown
    const select = elements.baristaName;
    const selectedValue = select.value;

    select.innerHTML = '<option value="">-- Pilih Barista --</option>';
    Object.entries(baristaList).forEach(([id, barista]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = barista.name;
        select.appendChild(option);
    });
    if (selectedValue) select.value = selectedValue;

    // Populate admin dropdown juga (pakai list yang sama)
    const adminSelect = document.getElementById('adminBaristaSelect');
    if (adminSelect) {
        const adminSelected = adminSelect.value;
        adminSelect.innerHTML = '<option value="">-- Pilih Barista --</option>';
        Object.entries(baristaList).forEach(([id, barista]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = barista.name;
            adminSelect.appendChild(option);
        });
        if (adminSelected) adminSelect.value = adminSelected;
    }
}

// ================================
// MAP
// ================================
function initMap() {
    if (typeof L === 'undefined') {
        showMessage('error', 'Map library gagal dimuat. Refresh halaman.');
        return;
    }

    const defaultCenter = [-7.571176486584326, 110.87119846027448];

    map = L.map('map', {
        center: defaultCenter,
        zoom: 17,
        zoomControl: true,
        scrollWheelZoom: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }).addTo(map);
}

function updateMapCafeMarker() {
    if (!map || !CAFE_LOCATION) return;

    if (cafeMarker) map.removeLayer(cafeMarker);
    if (radiusCircle) map.removeLayer(radiusCircle);

    const cafeIcon = L.divIcon({
        className: 'custom-cafe-marker',
        html: '<div style="background-color:#333;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3)"><div style="background-color:white;width:10px;height:10px;border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg)"></div></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });

    cafeMarker = L.marker([CAFE_LOCATION.lat, CAFE_LOCATION.lng], { icon: cafeIcon }).addTo(map);
    cafeMarker.bindPopup('<b>SECTOR SEVEN</b><br>Lokasi Cafe').openPopup();

    radiusCircle = L.circle([CAFE_LOCATION.lat, CAFE_LOCATION.lng], {
        color: '#4CAF50',
        fillColor: '#4CAF50',
        fillOpacity: 0.15,
        radius: MAX_DISTANCE,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(map);

    radiusCircle.bindPopup(`Area kerja (radius ${MAX_DISTANCE}m)`);
    map.setView([CAFE_LOCATION.lat, CAFE_LOCATION.lng], 17);
}

function updateMapUserLocation(lat, lng, inRange) {
    if (!map) return;

    if (userMarker) map.removeLayer(userMarker);

    const markerColor = inRange ? '#2196F3' : '#f44336';
    const userIcon = L.divIcon({
        className: 'custom-user-marker',
        html: `<div style="background-color:${markerColor};width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3)"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);

    const distance = calculateDistance(lat, lng, CAFE_LOCATION.lat, CAFE_LOCATION.lng);
    userMarker.bindPopup(`<b>Lokasi Anda</b><br>${inRange ? 'Dalam area kerja' : 'Di luar area kerja'}<br>Jarak: ${Math.round(distance)}m`);

    map.fitBounds(L.latLngBounds([
        [CAFE_LOCATION.lat, CAFE_LOCATION.lng],
        [lat, lng]
    ]), { padding: [50, 50] });
}

// ================================
// DATE TIME
// ================================
function updateDateTime() {
    document.getElementById('datetime').textContent = new Date().toLocaleDateString('id-ID', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

// ================================
// GEOLOCATION (Cepat: tanpa enableHighAccuracy)
// ================================
function startGeolocation() {
    return new Promise(resolve => {
        if (!navigator.geolocation) {
            updateRadiusStatus('error', 'Browser tidak mendukung GPS');
            resolve();
            return;
        }

        updateRadiusStatus('checking', 'Memeriksa lokasi...');

        navigator.geolocation.getCurrentPosition(
            position => {
                handleLocationSuccess(position);
                resolve();
            },
            error => {
                handleLocationError(error);
                resolve();
            },
            {
                enableHighAccuracy: false, // Lebih cepat, pakai WiFi/cell tower
                timeout: 8000,
                maximumAge: 120000         // Cache lokasi 2 menit
            }
        );
    });
}

// Untuk refresh manual (tombol atau watch)
function requestLocation() {
    if (!navigator.geolocation) {
        updateRadiusStatus('error', 'Browser tidak mendukung GPS');
        return;
    }
    updateRadiusStatus('checking', 'Memeriksa lokasi...');
    navigator.geolocation.getCurrentPosition(
        handleLocationSuccess,
        handleLocationError,
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
    );
}

function handleLocationSuccess(position) {
    if (!CAFE_LOCATION || !MAX_DISTANCE) {
        setTimeout(() => handleLocationSuccess(position), 500);
        return;
    }

    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const distance = calculateDistance(lat, lng, CAFE_LOCATION.lat, CAFE_LOCATION.lng);
    const inRange = distance <= MAX_DISTANCE;

    currentLocation = { lat, lng };
    isInRange = inRange;

    if (elements.latValue) elements.latValue.textContent = lat.toFixed(6);
    if (elements.lngValue) elements.lngValue.textContent = lng.toFixed(6);

    if (inRange) {
        updateRadiusStatus('in-range', `Dalam Radius: ${Math.round(distance)} meter`);
    } else {
        updateRadiusStatus('out-range', `Di Luar Radius: ${Math.round(distance)} meter`);
    }

    updateMapUserLocation(lat, lng, inRange);
}

function handleLocationError(error) {
    const messages = {
        [error.PERMISSION_DENIED]:    'Izin lokasi ditolak. Mohon aktifkan GPS',
        [error.POSITION_UNAVAILABLE]: 'Informasi lokasi tidak tersedia',
        [error.TIMEOUT]:              'Permintaan lokasi timeout. Coba lagi.'
    };
    updateRadiusStatus('error', messages[error.code] || 'Tidak dapat mengakses lokasi');
    isInRange = false;
}

function updateRadiusStatus(cssClass, text) {
    if (elements.radiusStatus) elements.radiusStatus.className = `radius-status ${cssClass}`;
    if (elements.radiusText)   elements.radiusText.textContent = text;
}

// ================================
// DISTANCE (Haversine)
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

// ================================
// ATTENDANCE HANDLER
// ================================
async function handleAttendance(type) {
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
    if (!isInRange) {
        showMessage('error', 'Anda berada di luar radius lokasi kerja');
        return;
    }

    elements.checkInBtn.disabled = true;
    elements.checkOutBtn.disabled = true;

    try {
        const response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
            method: 'POST',
            // Tanpa Content-Type header agar tidak trigger CORS preflight
            body: JSON.stringify({
                action: 'attendance',
                timestamp: new Date().toISOString(),
                baristaId,
                pin,
                type,
                latitude: currentLocation.lat,
                longitude: currentLocation.lng
            })
        });

        const result = await response.json();

        if (result.success) {
            showMessage('success', result.message);
            elements.baristaName.value = '';
            elements.pin.value = '';
            setTimeout(loadTodayHistory, 1500);
        } else {
            showMessage('error', result.message || 'Gagal menyimpan presensi');
        }

    } catch (error) {
        showMessage('error', 'Gagal menghubungi server: ' + error.message);
    } finally {
        elements.checkInBtn.disabled = false;
        elements.checkOutBtn.disabled = false;
    }
}

// ================================
// HISTORY
// ================================
async function loadTodayHistory() {
    try {
        const response = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=getHistory`);
        if (!response.ok) throw new Error('Network error');

        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            displayHistory(result.data);
        } else {
            elements.todayHistory.innerHTML = '<p class="no-data">Belum ada presensi hari ini</p>';
        }
    } catch (error) {
        elements.todayHistory.innerHTML = '<p class="no-data">Gagal memuat riwayat</p>';
    }
}

function displayHistory(data) {
    elements.todayHistory.innerHTML = data.map(item => `
        <div class="history-item ${item.type === 'in' ? 'check-in' : 'check-out'}">
            <div class="history-info">
                <div class="history-name">${item.name}</div>
                <div class="history-time">${item.waktu}</div>
            </div>
            <span class="history-badge ${item.type === 'in' ? 'in' : 'out'}">${item.type === 'in' ? 'Masuk' : 'Keluar'}</span>
        </div>
    `).join('');
}

// ================================
// MESSAGE
// ================================
function showMessage(type, text) {
    elements.message.className = `message ${type} show`;
    elements.message.textContent = text;
    setTimeout(() => elements.message.classList.remove('show'), 5000);
}

// ================================
// ADMIN PANEL
// ================================

const STORE_STATUS_URL = 'https://sectorseven.space/.netlify/functions/store-status';
const MOKA_ITEMS_URL   = 'https://sectorseven.space/.netlify/functions/moka-items';

let adminPin         = null;
let adminBaristaId   = null;
let storeIsOpen      = true;
let unavailableItems = [];
let allMenuItems     = [];

function initAdmin() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');
        });
    });

    // PIN gate — pakai barista ID + PIN yang sama dengan presensi
    const selectEl = document.getElementById('adminBaristaSelect');
    const pinInput  = document.getElementById('adminPin');
    const pinBtn    = document.getElementById('adminPinBtn');

    async function tryAdminLogin() {
        const baristaId = selectEl.value;
        const pin       = pinInput.value.trim();

        if (!baristaId) { showAdminPinMsg('Pilih nama barista'); return; }
        if (pin.length < 4) { showAdminPinMsg('PIN harus 4 digit'); return; }

        pinBtn.disabled = true;
        pinBtn.textContent = 'Memeriksa...';

        try {
            // Validasi ke Apps Script — endpoint validatePin
            const res  = await fetch(`${CONFIG.GOOGLE_SCRIPT_URL}?action=validatePin&baristaId=${encodeURIComponent(baristaId)}&pin=${encodeURIComponent(pin)}`);
            const data = await res.json();

            if (data.success) {
                adminPin = pin;
                adminBaristaId = baristaId;
                document.getElementById('adminPinGate').style.display = 'none';
                document.getElementById('adminControls').style.display = 'block';
                await loadAdminData();
            } else {
                showAdminPinMsg(data.message || 'PIN salah');
                pinInput.value = '';
            }
        } catch (e) {
            showAdminPinMsg('Gagal terhubung ke server');
        } finally {
            pinBtn.disabled = false;
            pinBtn.textContent = 'Masuk';
        }
    }

    pinBtn.addEventListener('click', tryAdminLogin);
    pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryAdminLogin(); });
    pinInput.addEventListener('input', e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); });

    // Store toggle
    document.getElementById('storeToggleBtn').addEventListener('click', toggleStore);
}

function showAdminPinMsg(text) {
    const el = document.getElementById('adminPinMsg');
    el.className = 'message error show';
    el.textContent = text;
    setTimeout(() => el.classList.remove('show'), 3000);
}

function showAdminMsg(text, type = 'success') {
    const el = document.getElementById('adminMsg');
    el.className = `message ${type} show`;
    el.textContent = text;
    setTimeout(() => el.classList.remove('show'), 3000);
}

async function loadAdminData() {
    await Promise.all([loadStoreStatus(), loadMenuItems()]);
}

async function loadStoreStatus() {
    try {
        const res  = await fetch(STORE_STATUS_URL);
        const data = await res.json();
        storeIsOpen      = data.isOpen !== false;
        unavailableItems = data.unavailableItems || [];
        renderStoreToggle();
    } catch (e) {
        console.error('[admin] Gagal load store status:', e);
    }
}

function renderStoreToggle() {
    const btn   = document.getElementById('storeToggleBtn');
    const label = document.getElementById('storeStatusLabel');

    if (storeIsOpen) {
        btn.classList.add('on');
        label.textContent = '🟢 Buka';
        label.className   = 'store-status-label open';
    } else {
        btn.classList.remove('on');
        label.textContent = '🔴 Tutup';
        label.className   = 'store-status-label closed';
    }
}

async function toggleStore() {
    const btn    = document.getElementById('storeToggleBtn');
    btn.disabled = true;
    const newVal = !storeIsOpen;

    try {
        const res  = await fetch(STORE_STATUS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baristaId: adminBaristaId, pin: adminPin, action: 'setOpen', isOpen: newVal }),
        });
        const data = await res.json();

        if (data.success) {
            storeIsOpen = newVal;
            renderStoreToggle();
            showAdminMsg(newVal ? 'Toko dibuka ✅' : 'Toko ditutup 🔴');
        } else {
            showAdminMsg(data.message || 'Gagal update status', 'error');
        }
    } catch (e) {
        showAdminMsg('Gagal terhubung ke server', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function loadMenuItems() {
    const container = document.getElementById('itemList');
    container.innerHTML = '<p class="no-data">Memuat menu...</p>';

    try {
        const res  = await fetch(MOKA_ITEMS_URL);
        const data = await res.json();
        allMenuItems = data.items || [];
        renderItemList();
    } catch (e) {
        container.innerHTML = '<p class="no-data">Gagal memuat menu</p>';
    }
}

// Helper: ambil nama kategori — Moka API: item.category = { id, name, ... }
function getCategoryName(item) {
    if (item.category && typeof item.category === 'object') return item.category.name || 'Lainnya';
    if (item.category && typeof item.category === 'string') return item.category;
    if (item.category_name && typeof item.category_name === 'string') return item.category_name;
    return 'Lainnya';
}

function renderItemList() {
    const container = document.getElementById('itemList');

    if (!allMenuItems.length) {
        container.innerHTML = '<p class="no-data">Tidak ada item</p>';
        return;
    }

    // Kelompokkan per kategori
    const categories = {};
    allMenuItems.forEach(item => {
        const cat = getCategoryName(item);
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(item);
    });

    container.innerHTML = Object.entries(categories).map(([catName, items]) => {
        const catIds     = items.map(item => String(item.item_id || item.id || ''));
        const availCount = catIds.filter(id => !unavailableItems.includes(id)).length;
        const allAvail   = availCount === catIds.length;
        const noneAvail  = availCount === 0;
        const catMixed   = !allAvail && !noneAvail;

        const itemsHtml = items.map(item => {
            const id          = String(item.item_id || item.id || '');
            const name        = item.item_name || item.name || '';
            const isAvailable = !unavailableItems.includes(id);
            return `
            <div class="item-row" data-item-id="${id}">
                <div class="item-row-info">
                    <div class="item-row-name ${isAvailable ? '' : 'unavailable'}">${name}</div>
                </div>
                <button class="item-toggle-btn ${isAvailable ? 'on' : ''}"
                        data-item-id="${id}"
                        data-available="${isAvailable}">
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </button>
            </div>`;
        }).join('');

        return `
        <div class="category-group">
            <div class="category-header">
                <div class="category-header-info">
                    <span class="category-header-name">${catName}</span>
                    <span class="category-header-count">${availCount}/${catIds.length} tersedia</span>
                </div>
                <button class="item-toggle-btn category-toggle-btn ${allAvail ? 'on' : ''} ${catMixed ? 'mixed' : ''}"
                        data-category="${catName}"
                        data-cat-available="${allAvail}">
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                </button>
            </div>
            <div class="category-items">${itemsHtml}</div>
        </div>`;
    }).join('');

    // ── Toggle item individual (optimistic) ───────────────────────────────────
    container.querySelectorAll('.item-toggle-btn:not(.category-toggle-btn)').forEach(btn => {
        btn.addEventListener('click', async () => {
            const itemId    = btn.dataset.itemId;
            const available = btn.dataset.available === 'true';
            const newVal    = !available;

            // Optimistic: update state lokal & re-render langsung
            if (newVal) {
                unavailableItems = unavailableItems.filter(id => id !== itemId);
            } else {
                if (!unavailableItems.includes(itemId)) unavailableItems.push(itemId);
            }
            renderItemList();

            // Kirim ke server di background
            try {
                const res  = await fetch(STORE_STATUS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ baristaId: adminBaristaId, pin: adminPin, action: 'toggleItem', itemId, available: newVal }),
                });
                const data = await res.json();
                if (data.success) {
                    unavailableItems = data.unavailableItems;
                    renderItemList();
                } else {
                    // Rollback jika gagal
                    if (newVal) { if (!unavailableItems.includes(itemId)) unavailableItems.push(itemId); }
                    else { unavailableItems = unavailableItems.filter(id => id !== itemId); }
                    renderItemList();
                    showAdminMsg(data.message || 'Gagal update item', 'error');
                }
            } catch (e) {
                showAdminMsg('Gagal terhubung ke server', 'error');
            }
        });
    });

    // ── Toggle seluruh kategori (optimistic) ──────────────────────────────────
    container.querySelectorAll('.category-toggle-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const catName  = btn.dataset.category;
            const catAvail = btn.dataset.catAvailable === 'true';
            const newVal   = !catAvail;

            const catIds = allMenuItems
                .filter(item => getCategoryName(item) === catName)
                .map(item => String(item.item_id || item.id || ''));

            // Optimistic update lokal
            if (newVal) {
                unavailableItems = unavailableItems.filter(id => !catIds.includes(id));
            } else {
                catIds.forEach(id => { if (!unavailableItems.includes(id)) unavailableItems.push(id); });
            }
            renderItemList();

            // Kirim 1 request toggleCategory ke server
            try {
                const res  = await fetch(STORE_STATUS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ baristaId: adminBaristaId, pin: adminPin, action: 'toggleCategory', itemIds: catIds, available: newVal }),
                });
                const data = await res.json();
                if (data.success) {
                    unavailableItems = data.unavailableItems;
                    renderItemList();
                    showAdminMsg(newVal ? `"${catName}" diaktifkan ✅` : `"${catName}" dinonaktifkan 🔴`);
                } else {
                    showAdminMsg(data.message || 'Gagal update kategori', 'error');
                    await loadStoreStatus(); renderItemList(); // rollback dari server
                }
            } catch (e) {
                showAdminMsg('Gagal terhubung ke server', 'error');
                await loadStoreStatus(); renderItemList();
            }
        });
    });
}