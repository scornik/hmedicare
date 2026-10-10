/** Login may return only to an opaque notification link, never to an arbitrary URL. */
export function shortLinkReturn(value: unknown): string {
  return typeof value === 'string' && /^\/r\/[A-Za-z0-9]{22}$/.test(value) ? value : '/select-tenant';
}
