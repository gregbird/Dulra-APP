import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  getLocation,
  getPermissionStatus,
  requestPermission,
  openLocationSettings,
  type LocationCoords,
  type LocationPermissionStatus,
} from "@/lib/location";

interface UseLocationResult {
  status: LocationPermissionStatus;
  location: LocationCoords | null;
  loading: boolean;
  request: () => Promise<LocationPermissionStatus>;
  refresh: () => Promise<LocationCoords | null>;
  openSettings: () => Promise<void>;
}

export function useLocation(): UseLocationResult {
  const [status, setStatus] = useState<LocationPermissionStatus>("undetermined");
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const refreshStatus = useCallback(async () => {
    const next = await getPermissionStatus();
    if (mountedRef.current) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshStatus();

    // When the user comes back from Settings (where they may have toggled
    // location permission), the app re-enters the active state — re-check
    // permission so the UI reflects the new value without a manual refresh.
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") refreshStatus();
    });

    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [refreshStatus]);

  const request = useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestPermission();
      if (mountedRef.current) setStatus(next);
      if (next === "granted") {
        const loc = await getLocation();
        if (mountedRef.current && loc) setLocation(loc);
      }
      return next;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loc = await getLocation({ maxAgeMs: 0 });
      if (mountedRef.current) setLocation(loc);
      return loc;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  return {
    status,
    location,
    loading,
    request,
    refresh,
    openSettings: openLocationSettings,
  };
}
