import { create } from "zustand";

/**
 * Dev-only event bus: DevTool fires a fill signal, whichever survey /
 * relevé form screen is mounted picks it up and autofills its state.
 * If no form is mounted the signal is harmless — no subscriber reacts.
 */
interface DevEventState {
  fillToken: number | null;
  addPhotosToken: number | null;
  requestFill: () => void;
  clearFillToken: () => void;
  requestAddPhotos: () => void;
  clearAddPhotosToken: () => void;
}

export const useDevEventStore = create<DevEventState>((set) => ({
  fillToken: null,
  addPhotosToken: null,
  requestFill: () => set({ fillToken: Date.now() }),
  clearFillToken: () => set({ fillToken: null }),
  requestAddPhotos: () => set({ addPhotosToken: Date.now() }),
  clearAddPhotosToken: () => set({ addPhotosToken: null }),
}));
