import * as Location from 'expo-location';
import { geohashForLocation } from 'geofire-common';

const round = (x: number, step = 0.01) => Math.round(x / step) * step;

export async function getApproxPosition() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') throw new Error('Permission localisation refusée');
    
    // Essayer d'abord la dernière position connue pour la rapidité
    let location = await Location.getLastKnownPositionAsync();

    if (!location) {
      location = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<Location.LocationObject>((_, reject) => 
          setTimeout(() => reject(new Error('Location timeout')), 10000)
        )
      ]);
    }

    const { coords } = location;
    
    // Arrondir pour protéger la vie privée
    const lat = round(coords.latitude, 0.01);
    const lng = round(coords.longitude, 0.01);
    const geohash = geohashForLocation([lat, lng]);
    
    return { 
      lat, 
      lng, 
      geohash, 
      precisionKm: 1, 
      accuracy: coords.accuracy,
      updatedAt: Date.now() 
    };
  } catch (error) {
    console.error('Erreur de géolocalisation:', error);
    // Retourner une position par défaut en cas d'erreur
    if (error instanceof Error) {
      throw new Error(`Impossible d'obtenir la position: ${error.message}`);
    } else {
      throw new Error('Impossible d\'obtenir la position: erreur inconnue');
    }
  }
}

/** Get precise GPS with timestamp and TTL (ms) */
export async function getPrecisePosition(ttlMs: number = 15 * 60 * 1000) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Permission localisation refusée');
  const { coords } = await Location.getCurrentPositionAsync({});
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    geohash: geohashForLocation([coords.latitude, coords.longitude]),
    precise: true,
    ttlMs,
    expiresAt: Date.now() + ttlMs,
    updatedAt: Date.now(),
  };
}

/** Adds ~250–500m jitter to coordinates for better privacy */
export function jitterCoordinate(lat: number, lng: number) {
  const rand = (max: number) => (Math.random() * 2 - 1) * max;
  // ~0.003 deg ~ 333m near equator
  const jLat = lat + rand(0.004);
  const jLng = lng + rand(0.004);
  return { lat: jLat, lng: jLng };
}
