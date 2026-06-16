/**
 * Neon Auth SDK requires crypto.randomUUID(), which browsers only expose in
 * secure contexts (https, localhost). Accessing Vite via http://192.168.x.x fails without this.
 */
export function ensureCryptoRandomUUID(): void {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.randomUUID === 'function') return;

  cryptoObj.randomUUID = function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

ensureCryptoRandomUUID();
