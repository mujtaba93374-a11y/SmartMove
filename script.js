/* SmartMove - real-time highway mode prototype
   - toggle map on/off via mapDemoBtn
   - initializes Leaflet map and watchPosition
   - detects frequent movement (distance/time) and prompts vehicle selection
   - shows floating status card with Mode + speed + motion
   - updates button to exact place name (reverse geocode)
*/

let map, userMarker, watchId = null;
let mapInitialized = false, mapVisible = false;
let lastPos = null;          // {lat, lon, timestamp}
let lastPromptTime = 0;      // ms since epoch
let userMode = null;         // 'car' or 'bus'
const PROMPT_COOLDOWN = 60 * 1000; // 60s between prompts when moving frequently
const MOVE_DIST_THRESHOLD = 200;   // meters threshold to consider "frequent movement"
const MOVE_TIME_WINDOW = 15 * 1000; // 15 seconds window considered "fast movement"

/* DOM */
const mapBtn = document.getElementById('mapDemoBtn');
const joinBtn = document.getElementById('joinBetaBtn');
const mapSection = document.getElementById('mapSection');
const locationStatus = document.getElementById('locationStatus');
const vehicleModal = document.getElementById('vehicleModal');
const chooseCar = document.getElementById('chooseCar');
const chooseBus = document.getElementById('chooseBus');
const statusCard = document.getElementById('statusCard');
const modeLabel = document.getElementById('modeLabel');
const speedLabel = document.getElementById('speedLabel');
const motionLabel = document.getElementById('motionLabel');

/* Util: haversine distance in meters */
function haversine(lat1, lon1, lat2, lon2) {
  function toRad(v){ return v * Math.PI / 180; }
  const R = 6371000;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* Initialize Leaflet map */
function initMap() {
  if (mapInitialized) return;
  map = L.map('map').setView([20.5937,78.9629],5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  mapInitialized = true;
}

/* Show vehicle modal */
function showVehicleModal() {
  vehicleModal.classList.add('show');
}
/* Close modal */
function closeVehicleModal() {
  vehicleModal.classList.remove('show');
}

/* Set user mode and show status */
function setUserMode(mode) {
  userMode = mode;
  modeLabel.textContent = mode === 'car' ? 'Mode: 🚗 Car' : 'Mode: 🚌 Bus';
  statusCard.classList.remove('hidden');
  // visually emphasize
  mapBtn.classList.add('glow');
  setTimeout(()=> mapBtn.classList.remove('glow'), 6000);
  closeVehicleModal();
}

/* Reverse geocode to get place name */
async function getPlaceName(lat, lon) {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const data = await resp.json();
    if (data && data.display_name) {
      // take first 3 elements for brevity
      return data.display_name.split(',').slice(0,3).join(',').trim();
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* Start watchPosition */
function startWatching() {
  if (!navigator.geolocation) {
    locationStatus.textContent = '❌ Geolocation not supported.';
    return;
  }

  // request high accuracy updates
  watchId = navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const ts = pos.timestamp || Date.now();

    // initialize map if not
    initMap();

    // center map on first fix
    if (!userMarker) {
      map.setView([lat, lon], 14);
      userMarker = L.marker([lat, lon]).addTo(map);
      userMarker.bindPopup('📍 You are here').openPopup();

      // reverse geocode once for button label
      const name = await getPlaceName(lat, lon);
      if (name) {
        mapBtn.textContent = `📍 ${name}`;
        mapBtn.classList.add('glow');
        setTimeout(()=> mapBtn.classList.remove('glow'), 6000);
      }
    } else {
      // move marker smoothly
      userMarker.setLatLng([lat, lon]);
    }

    // compute speed (km/h). prefer device-provided speed (m/s) else compute
    let speedKmh = 0;
    if (typeof pos.coords.speed === 'number' && !isNaN(pos.coords.speed)) {
      speedKmh = Math.round(pos.coords.speed * 3.6);
    } else if (lastPos) {
      const dist = haversine(lastPos.lat, lastPos.lon, lat, lon); // meters
      const dt = Math.max((ts - lastPos.ts)/1000, 0.5); // seconds avoid div0
      speedKmh = Math.round((dist / dt) * 3.6);
    }

    speedLabel.textContent = speedKmh;

    // update motion label
    if (speedKmh < 5) {
      motionLabel.textContent = 'Status: 🟡 Stationary';
    } else {
      motionLabel.textContent = 'Status: 🟢 Moving';
    }

    // If user mode is set, show mode; else show placeholder
    if (!userMode) {
      modeLabel.textContent = 'Mode: —';
    }

    // Movement detection to trigger vehicle modal:
    // If lastPos exists and user moved more than threshold within short window => prompt
    if (lastPos) {
      const dist = haversine(lastPos.lat, lastPos.lon, lat, lon);
      const dtMs = ts - lastPos.ts;
      // frequent movement: moved > threshold within MOVE_TIME_WINDOW
      const timeCondition = dtMs <= MOVE_TIME_WINDOW;
      const distCondition = dist >= MOVE_DIST_THRESHOLD;
      const now = Date.now();
      if ((timeCondition && distCondition) && (now - lastPromptTime > PROMPT_COOLDOWN)) {
        // prompt to choose vehicle type
        showVehicleModal();
        lastPromptTime = now;
      }
    }

    // store lastPos every update
    lastPos = { lat, lon, ts };

  }, (err) => {
    locationStatus.textContent = '⚠️ Unable to access location. Please allow location access.';
  }, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000
  });
}

/* Stop watching */
function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  // hide status and marker (keep place name on button)
  statusCard.classList.add('hidden');
  if (userMarker) {
    try { map.removeLayer(userMarker); } catch(e){}
    userMarker = null;
  }
}

/* button: show/hide map and start/stop tracking */
mapBtn.addEventListener('click', async (ev) => {
  ev.preventDefault();

  // If map is visible => hide it
  if (mapVisible) {
    // hide map
    mapSection.style.opacity = '0';
    setTimeout(()=> { mapSection.style.display = 'none'; }, 450);
    mapVisible = false;
    stopWatching();
    return;
  }

  // show map
  mapSection.style.display = 'block';
  setTimeout(()=> mapSection.style.opacity = '1', 60);
  mapVisible = true;
  locationStatus.textContent = '📡 Preparing map...';

  // Initialize map if needed and attempt to start watching
  initMap();

  // Try permission check: if already granted, auto start; else startWatch triggers prompt
  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      if (p.state === 'granted') {
        locationStatus.textContent = '📡 Fetching your location...';
        startWatching();
      } else if (p.state === 'prompt') {
        locationStatus.textContent = '📡 Asking for location permission...';
        startWatching(); // this will show browser prompt
      } else {
        locationStatus.textContent = '⚠️ Location permission denied. Enable in browser settings.';
      }
      // optional: handle state changes later
      p.onchange = () => { /* could react to permission change */ };
    } else {
      // no permissions API: just start watching (will prompt)
      startWatching();
    }
  } catch (e) {
    // fallback
    startWatching();
  }
});

/* Join beta simple handler */
joinBtn.addEventListener('click', (e) => {
  e.preventDefault();
  const mail = prompt('Enter your email to join SmartMove Beta (optional):');
  if (mail) alert('Thanks! We will notify you.');
});

/* Vehicle modal choices */
chooseCar.addEventListener('click', () => setUserMode('car'));
chooseBus.addEventListener('click', () => setUserMode('bus'));

/* allow closing modal via function for close-x button */
function closeVehicleModal() {
  vehicleModal.classList.remove('show');
}

/* Clean up on unload (stop watching) */
window.addEventListener('beforeunload', () => {
  stopWatching();
});
