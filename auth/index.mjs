// Admission Hub Authentication Foundation, Phase 2A public boundary.
// App features may import only this file; internal service/core imports are forbidden.
export { createAuthFoundation } from './create-auth-foundation.mjs';
export { AUTH_FOUNDATION_VERSION, AUTH_STATES, AUTH_METHODS, AUTH_ERROR_TYPES, AUTH_ERROR_CODES, AUTH_PUBLIC_METHODS } from './core/constants.mjs';
export { AuthError, classifyAuthError, publicAuthError } from './core/errors.mjs';
