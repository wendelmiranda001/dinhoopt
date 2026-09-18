// Web permissions the renderer is allowed to request. Everything else is
// denied — system features go through IPC instead of web APIs. Fullscreen is
// allowed so the clip editor can use the HTML5 Fullscreen API (the global
// request handler would otherwise reject `element.requestFullscreen()`).
const ALLOWED_WEB_PERMISSIONS = new Set<string>(['fullscreen'])

export function isWebPermissionAllowed(permission: string): boolean {
  return ALLOWED_WEB_PERMISSIONS.has(permission)
}
