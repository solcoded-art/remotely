export function serviceURL(raw: string) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error('Use the server origin, such as https://remote.example.com.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw Error('Use HTTPS for your account server. HTTP is allowed only on localhost.');
  return url.origin;
}

export async function request<T>(service: string, route: string, options: { token?: string; method?: string; data?: unknown } = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(service + route, {
    method: options.method || 'GET',
    credentials: 'include',
    headers: { ...(options.data ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.data ? JSON.stringify(options.data) : undefined,
    signal: AbortSignal.timeout(15000),
  }); } catch (error) {
    if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name)) throw Error('The account server took too long to respond. Check your connection and try again.');
    throw Error('Unable to reach the account server. Check your internet connection and the account server URL, then try again.');
  }
  let data;
  try { data = await response.json(); } catch { throw Error('The account server did not return JSON. Check its URL.'); }
  if (!response.ok) throw Object.assign(Error(data.error || 'The request failed.'), { status: response.status });
  return data;
}
