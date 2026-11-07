export type DeviceInfo = {
  fingerprint: string;
  deviceName: string;
  deviceType: string;
  browser: string;
  operatingSystem: string;
};

function detectDeviceType(): string {
  const ua = navigator.userAgent.toLowerCase();

  if (/tablet|ipad/.test(ua)) return "tablet";
  if (/mobile|android|iphone|ipod/.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(): string {
  const ua = navigator.userAgent;

  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua)) return "Opera";
  if (/chrome\//i.test(ua)) return "Chrome";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/safari\//i.test(ua)) return "Safari";

  return "Unknown";
}

function detectOperatingSystem(): string {
  const ua = navigator.userAgent;

  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";

  return "Unknown";
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const storageKey = "ultima_device_seed";

  let seed = localStorage.getItem(storageKey);

  if (!seed) {
    seed = crypto.randomUUID();
    localStorage.setItem(storageKey, seed);
  }

  const rawFingerprint = [
    seed,
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");

  const fingerprint = await sha256(rawFingerprint);

  return {
    fingerprint,
    deviceName: `${detectOperatingSystem()} ${detectBrowser()}`,
    deviceType: detectDeviceType(),
    browser: detectBrowser(),
    operatingSystem: detectOperatingSystem(),
  };
}
