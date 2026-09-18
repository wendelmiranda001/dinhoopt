import { describe, expect, it } from 'vitest'
import { isWebPermissionAllowed } from './web-permissions'

describe('web-permissions', () => {
  it('allows fullscreen so the clip editor can enter fullscreen', () => {
    expect(isWebPermissionAllowed('fullscreen')).toBe(true)
  })

  it('denies media/geolocation and all other permissions', () => {
    const denied = ['media', 'geolocation', 'notifications', 'clipboard-read', 'midi', 'pointerLock', 'unknown']
    for (const permission of denied) {
      expect(isWebPermissionAllowed(permission)).toBe(false)
    }
  })
})
