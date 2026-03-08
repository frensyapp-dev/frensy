import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebaseconfig';
import { geohashForLocation } from 'geofire-common';

export const LOCATION_TASK_NAME = 'background-location-task';

// Define the background task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[backgroundLocation] Task error:', error);
    return;
  }
  
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    
    // Ensure auth is ready
    let user = auth.currentUser;
    if (!user) {
       await new Promise<void>(resolve => {
          const unsub = onAuthStateChanged(auth, (u) => {
             if (u) {
               user = u;
               resolve();
             }
          });
          // Timeout after 2s if no user restored (e.g. really logged out)
          setTimeout(() => {
             unsub();
             resolve();
          }, 2000);
       });
    }

    if (!user) {
      // Still no user, abort
      return;
    }

    if (locations && locations.length > 0) {
      const location = locations[locations.length - 1]; // Use the latest location
      const { latitude, longitude, accuracy } = location.coords;
      
      const lat = Math.round(latitude * 100) / 100; // Round to ~1km for privacy/consistency with foreground
      const lng = Math.round(longitude * 100) / 100;
      const geohash = geohashForLocation([lat, lng]);
      const now = Date.now();

      try {
        // We only update the core position data.
        // We assume 'name', 'img' etc are already set by the foreground logic.
        // We set isManualBase to false because this is a real GPS update.
        await setDoc(doc(db, 'positions', user.uid), {
          lat,
          lng,
          geohash,
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
          accuracy: accuracy ?? null,
          precisionKm: 0.1, // Active tracking
          // isManualBase: false, // DO NOT overwrite manual base
        }, { merge: true });
        
        // console.log('[backgroundLocation] Position updated', lat, lng);
      } catch (e) {
        console.error('[backgroundLocation] Firebase update failed:', e);
      }
    }
  }
});

/**
 * Starts background location updates if permissions are granted.
 * Should be called when the user is logged in and tracking is desired.
 */
export async function startBackgroundTracking() {
  try {
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status === 'granted') {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (!hasStarted) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15 * 60 * 1000, // Update every 15 minutes to save battery
          distanceInterval: 100, // Or every 100 meters
          foregroundService: {
            notificationTitle: "Frensy est actif",
            notificationBody: "Votre position est mise à jour pour vos amis.",
            notificationColor: "#000000",
          },
        });
        console.log('[backgroundLocation] Started');
      }
    }
  } catch (e) {
    console.error('[backgroundLocation] Failed to start:', e);
  }
}

/**
 * Stops background location updates.
 */
export async function stopBackgroundTracking() {
  try {
    const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (hasStarted) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      console.log('[backgroundLocation] Stopped');
    }
  } catch (e) {
    console.error('[backgroundLocation] Failed to stop:', e);
  }
}
