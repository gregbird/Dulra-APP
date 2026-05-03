import * as Location from "expo-location";
import { Linking, Platform } from "react-native";

export type LocationPermissionStatus = "granted" | "denied" | "undetermined";

export interface LocationCoords {
  lat: number;
  lng: number;
  accuracy: number | null;
}

interface CachedLocation extends LocationCoords {
  timestamp: number;
}

let cached: CachedLocation | null = null;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function mapStatus(status: Location.PermissionStatus): LocationPermissionStatus {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

export async function getPermissionStatus(): Promise<LocationPermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return mapStatus(status);
}

export async function requestPermission(): Promise<LocationPermissionStatus> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return mapStatus(status);
}

export async function openLocationSettings(): Promise<void> {
  // Linking.openSettings() ships with the app in expo-linking; on both iOS
  // and Android it deep-links into the app's permission page where the user
  // can flip Location back on after a previous denial.
  if (Platform.OS === "ios" || Platform.OS === "android") {
    await Linking.openSettings();
  }
}

/**
 * Returns a fresh-enough location, requesting permission if needed.
 * `maxAgeMs` controls how stale the cached value can be before refetching;
 * pass a small value (e.g. 60_000) for photo capture, larger (default 5min)
 * for survey form auto-fill.
 */
export async function getLocation(
  options: { maxAgeMs?: number } = {}
): Promise<LocationCoords | null> {
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (cached && Date.now() - cached.timestamp < maxAge) {
    return { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy };
  }

  const status = await getPermissionStatus();
  if (status !== "granted") return null;

  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    cached = {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? null,
      timestamp: Date.now(),
    };
    return { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy };
  } catch {
    return null;
  }
}

/**
 * Returns the OS-cached last known location if available. Permission is
 * still required, but no GPS fix is taken — useful for instant UI like
 * proximity sorting without waiting for a satellite lock.
 */
export async function getLastKnownLocation(): Promise<LocationCoords | null> {
  const status = await getPermissionStatus();
  if (status !== "granted") return null;
  try {
    const loc = await Location.getLastKnownPositionAsync();
    if (!loc) return null;
    return {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}

export function clearLocationCache(): void {
  cached = null;
}
