/** Mic listing / capture helpers for Teleprompter voice follow. */

export type TeleprompterMicDevice = {
  deviceId: string;
  label: string;
};

export const TELEPROMPTER_MIC_STORAGE_KEY = 'ros.teleprompter.micDeviceId';

export function readStoredMicId(): string {
  try {
    return localStorage.getItem(TELEPROMPTER_MIC_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeStoredMicId(deviceId: string): void {
  try {
    if (deviceId) localStorage.setItem(TELEPROMPTER_MIC_STORAGE_KEY, deviceId);
    else localStorage.removeItem(TELEPROMPTER_MIC_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function listAudioInputDevices(): Promise<TeleprompterMicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId)
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label?.trim() || `Microphone ${i + 1}`,
    }));
}

/** Ask for mic permission so device labels/ids populate, then list inputs. */
export async function unlockAndListMics(preferredDeviceId?: string): Promise<{
  devices: TeleprompterMicDevice[];
  stream: MediaStream;
}> {
  const audio: MediaTrackConstraints = preferredDeviceId
    ? { deviceId: { ideal: preferredDeviceId }, echoCancellation: true, noiseSuppression: true }
    : { echoCancellation: true, noiseSuppression: true };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const devices = await listAudioInputDevices();
  return { devices, stream };
}

export function audioConstraintsForMic(deviceId: string): MediaStreamConstraints {
  return {
    audio: deviceId
      ? { deviceId: { ideal: deviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true },
  };
}

export function computeMicLevelFromTimeDomain(data: Uint8Array): number {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  const rms = Math.sqrt(sum / Math.max(1, data.length));
  return Math.min(100, Math.round(Math.max(rms * 380, peak * 160)));
}
