export const MAX_RESOURCE_IMAGES = 10;
export const MAX_IMAGE_URL_LENGTH = 2048;

export function isHttpImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_IMAGE_URL_LENGTH) return false;
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function isValidImageList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_RESOURCE_IMAGES && value.every(isHttpImageUrl);
}
