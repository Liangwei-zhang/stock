export function isJsonResponse(res: Response): boolean {
  const contentType = typeof res.headers?.get === 'function'
    ? res.headers.get('content-type') ?? ''
    : '';
  if (!contentType) return true;
  return contentType.includes('application/json') || contentType.includes('application/problem+json');
}

export async function readJsonIfAvailable<T>(res: Response): Promise<T | null> {
  if (!isJsonResponse(res)) return null;
  return res.json() as Promise<T>;
}