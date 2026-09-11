/**
 * Real-time Geolocation and Manual Location Management Module.
 * Connects directly to device GPS (navigator.geolocation) and
 * provides reverse geocoding via OpenStreetMap Nominatim.
 */

const SAVED_LOCATIONS_KEY = 'sentrywing_saved_locations';

/**
 * Acquire high-accuracy real-time GPS coordinates from device hardware.
 */
export async function getRealTimeLocation() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Geolocation hardware not supported by browser.'));
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        const accuracy = Math.round(pos.coords.accuracy || 0);

        let placeName = `Real-Time GPS: ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
        try {
          const resolvedName = await reverseGeocode(lat, lng);
          if (resolvedName) {
            placeName = resolvedName;
          }
        } catch (e) {
          console.warn('Reverse geocode fallback:', e);
        }

        resolve({
          lat,
          lng,
          name: placeName,
          accuracy,
          isLive: true,
          timestamp: new Date().toISOString()
        });
      },
      (err) => {
        reject(new Error(err.message || 'Unable to retrieve device GPS fix.'));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

/**
 * Reverse geocodes coordinates to a human-readable place name.
 */
export async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SentryWing-Wildlife-Intelligence-Platform/2.0'
      }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.display_name) {
        // Return concise address components (e.g. Village/Subdistrict, District, State)
        const a = data.address || {};
        const parts = [
          a.suburb || a.village || a.town || a.city_district || a.city,
          a.county || a.state_district || a.state,
          a.country
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : data.display_name.split(',').slice(0, 3).join(',');
      }
    }
  } catch (err) {
    console.warn('Reverse geocode request failed:', err);
  }
  return null;
}

/**
 * Load user's saved manual locations from localStorage.
 */
export function getSavedManualLocations() {
  try {
    const raw = localStorage.getItem(SAVED_LOCATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Save a new manual location to localStorage.
 */
export function saveManualLocation(loc) {
  try {
    const existing = getSavedManualLocations();
    const newLoc = {
      id: 'loc_' + Date.now().toString(36),
      name: loc.name.trim(),
      lat: parseFloat(parseFloat(loc.lat).toFixed(6)),
      lng: parseFloat(parseFloat(loc.lng).toFixed(6)),
      isLive: false,
      createdAt: new Date().toISOString()
    };
    const updated = [newLoc, ...existing.filter(item => item.name !== newLoc.name)].slice(0, 20);
    localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.error('Failed to save manual location:', e);
    return [];
  }
}

/**
 * Delete a saved manual location.
 */
export function deleteSavedManualLocation(id) {
  try {
    const existing = getSavedManualLocations();
    const updated = existing.filter(l => l.id !== id);
    localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    return [];
  }
}
