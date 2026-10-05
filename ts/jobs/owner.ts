import type { ServerContext } from '@modelcontextprotocol/server'

/**
 * Derive the job owner key for a request. Returns undefined (anonymous, possession-based access)
 * unless `trustProxyAuth` is set AND the Easy Auth principal headers are present. Those headers
 * are only trustworthy behind an ingress that strips client-supplied copies — Azure Container
 * Apps auth does; a bare local listener does not, which is why the flag is explicit. An app-only
 * token yields the application's principal id, so every caller through that app shares one owner.
 */
export const ownerOf = (ctx: ServerContext, trustProxyAuth: boolean): string | undefined => {
   if (!trustProxyAuth) return undefined
   const
      headers = ctx.http?.req?.headers,
      id = headers?.get('x-ms-client-principal-id'),
      idp = headers?.get('x-ms-client-principal-idp') ?? 'aad'
   return id ? `${idp}|${id}` : undefined
}
