const IDENTITY_TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';
const DEFAULT_CONTINUE_URL = 'https://admissionsky.pages.dev/?firebaseVerified=1';

export class FirebaseRequestError extends Error {
  constructor(reason = 'FIREBASE_UNAVAILABLE', status = 0) {
    super(reason);
    this.name = 'FirebaseRequestError';
    this.reason = String(reason || 'FIREBASE_UNAVAILABLE').slice(0, 80);
    this.status = Number(status || 0);
  }
}

const errorReason = payload => String(payload?.error?.message || 'FIREBASE_UNAVAILABLE')
  .split(/\s*:\s*/, 1)[0]
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9_-]/g, '_')
  .slice(0, 80) || 'FIREBASE_UNAVAILABLE';

const validApiKey = value => /^[A-Za-z0-9_-]{20,128}$/.test(String(value || ''));
const validToken = value => typeof value === 'string' && value.length >= 20 && value.length <= 4096 && !/[\r\n\u0000;]/.test(value);
const validSubject = value => typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\r\n\u0000]/.test(value);
const validGoogleClientId = value => /^\d{6,}-[A-Za-z0-9_-]{8,}\.apps\.googleusercontent\.com$/.test(String(value || ''));
const validFacebookAppId = value => /^\d{6,20}$/.test(String(value || ''));
const FACEBOOK_AUTH_HOST = 'www.facebook.com';
const FACEBOOK_GRAPH = 'https://graph.facebook.com';

function safeContinueUrl(value) {
  try {
    const url = new URL(String(value || DEFAULT_CONTINUE_URL));
    if (url.protocol !== 'https:' || !['admissionhub.pages.dev', 'admissionsky.pages.dev'].includes(url.hostname)) return DEFAULT_CONTINUE_URL;
    return url.href;
  } catch { return DEFAULT_CONTINUE_URL; }
}

function googleIdpFromProject(payload) {
  const entries = Array.isArray(payload?.idpConfig) ? payload.idpConfig : [];
  const row = entries.find(item => {
    const provider = String(item?.provider || item?.providerId || '').toLowerCase();
    return provider === 'google' || provider === 'google.com';
  });
  const clientId = String(row?.clientId || '');
  return Object.freeze({
    enabled: row?.enabled === true,
    clientId: validGoogleClientId(clientId) ? clientId : ''
  });
}

function facebookIdpFromProject(payload) {
  const entries = Array.isArray(payload?.idpConfig) ? payload.idpConfig : [];
  const row = entries.find(item => {
    const provider = String(item?.provider || item?.providerId || '').toLowerCase();
    return provider === 'facebook' || provider === 'facebook.com';
  });
  const clientId = String(row?.clientId || '');
  return Object.freeze({
    enabled: row?.enabled === true,
    clientId: validFacebookAppId(clientId) ? clientId : ''
  });
}

function googleCredential(input = {}) {
  const idToken = String(input.idToken || '').trim();
  const accessToken = String(input.accessToken || '').trim();
  if (Boolean(idToken) === Boolean(accessToken)) throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
  const value = idToken || accessToken;
  if (!validToken(value)) throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
  return Object.freeze({ kind: idToken ? 'id_token' : 'access_token', value });
}

export class FirebaseEmailPasswordProvider {
  constructor({ apiKey, continueUrl, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.continueUrl = safeContinueUrl(continueUrl);
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
  }

  get configured() { return validApiKey(this.apiKey) && typeof this.fetch === 'function'; }

  async inspectProject() {
    if (!this.configured) throw new FirebaseRequestError('NOT_CONFIGURED');
    let response;
    try {
      response = await this.fetch(`${IDENTITY_TOOLKIT}/projects?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new FirebaseRequestError('NETWORK_ERROR'); }
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new FirebaseRequestError(errorReason(payload), response.status);
    const authorizedDomains = Array.isArray(payload?.authorizedDomains)
      ? payload.authorizedDomains.map(value => String(value).toLowerCase())
      : [];
    return Object.freeze({
      projectIdentified: typeof payload?.projectId === 'string' && payload.projectId.length > 3,
      continueDomainAuthorized: authorizedDomains.includes(new URL(this.continueUrl).hostname),
      google: googleIdpFromProject(payload),
      facebook: facebookIdpFromProject(payload)
    });
  }

  async #post(url, body, { form = false } = {}) {
    if (!this.configured) throw new FirebaseRequestError('NOT_CONFIGURED');
    let response;
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
          Accept: 'application/json',
          'Cache-Control': 'no-store'
        },
        body: form ? String(body) : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new FirebaseRequestError('NETWORK_ERROR'); }
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new FirebaseRequestError(errorReason(payload), response.status);
    return payload;
  }

  async inspectGoogleProvider() {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:createAuthUri?key=${encodeURIComponent(this.apiKey)}`, {
      providerId: 'google.com',
      continueUri: new URL(this.continueUrl).origin,
      customParameter: { prompt: 'select_account' }
    });
    let authUri;
    try { authUri = new URL(String(payload?.authUri || '')); } catch { throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE'); }
    const clientId = authUri.searchParams.get('client_id') || '';
    if (payload?.providerId !== 'google.com' || !validToken(String(payload?.sessionId || '')) || authUri.protocol !== 'https:' || authUri.hostname !== 'accounts.google.com' || !validGoogleClientId(clientId)) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({ available: true, clientId });
  }

  async inspectFacebookProvider() {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:createAuthUri?key=${encodeURIComponent(this.apiKey)}`, {
      providerId: 'facebook.com',
      continueUri: new URL(this.continueUrl).origin
    });
    let authUri;
    try { authUri = new URL(String(payload?.authUri || '')); } catch { throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE'); }
    const appId = authUri.searchParams.get('client_id') || '';
    if (payload?.providerId !== 'facebook.com' || !validToken(String(payload?.sessionId || '')) || authUri.protocol !== 'https:' || authUri.hostname !== FACEBOOK_AUTH_HOST || !validFacebookAppId(appId)) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({ available: true, clientId: appId });
  }

  async inspectGoogleRedirectFlow(sessionId) {
    if (!validToken(sessionId)) throw new FirebaseRequestError('INVALID_SESSION_ID');
    const continueUri = 'https://admissionsky.pages.dev/?googleAuthCallback=1';
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:createAuthUri?key=${encodeURIComponent(this.apiKey)}`, {
      providerId: 'google.com',
      continueUri,
      sessionId,
      authFlowType: 'CODE_FLOW',
      customParameter: { prompt: 'select_account' }
    });
    let authUri;
    let redirectUri;
    try {
      authUri = new URL(String(payload?.authUri || ''));
      redirectUri = new URL(String(authUri.searchParams.get('redirect_uri') || ''));
    } catch { throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE'); }
    const clientId = authUri.searchParams.get('client_id') || '';
    const responseTypes = new Set(String(authUri.searchParams.get('response_type') || '').split(/\s+/).filter(Boolean));
    const callbackKind = redirectUri.protocol === 'https:' && redirectUri.hostname.endsWith('.firebaseapp.com') && redirectUri.pathname === '/__/auth/handler'
      ? 'firebase-handler'
      : redirectUri.origin === new URL(continueUri).origin
        ? 'pages-origin'
        : 'other';
    if (
      payload?.providerId !== 'google.com' ||
      payload?.sessionId !== sessionId ||
      authUri.protocol !== 'https:' ||
      authUri.hostname !== 'accounts.google.com' ||
      !validGoogleClientId(clientId) ||
      !responseTypes.has('code') ||
      redirectUri.protocol !== 'https:'
    ) throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    let authorizationResponse;
    try {
      authorizationResponse = await this.fetch(authUri.href, {
        method: 'GET',
        headers: { Accept: 'text/html', 'Cache-Control': 'no-store' },
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new FirebaseRequestError('NETWORK_ERROR'); }
    const redirected = authorizationResponse.status >= 300 && authorizationResponse.status < 400;
    if (!authorizationResponse.ok && !redirected) throw new FirebaseRequestError('OAUTH_AUTHORIZATION_REQUEST_REJECTED', authorizationResponse.status);
    if (redirected) {
      let location;
      try { location = new URL(String(authorizationResponse.headers.get('Location') || ''), authUri); }
      catch { throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE'); }
      if (location.protocol !== 'https:' || location.hostname !== 'accounts.google.com') {
        throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
      }
    }
    return Object.freeze({
      available: true,
      sessionBound: true,
      responseMode: 'code',
      callbackKind,
      authorizationRequestAccepted: true
    });
  }

  async signUp(email, password) {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signUp?key=${encodeURIComponent(this.apiKey)}`, {
      email, password, returnSecureToken: true
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId)) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({ idToken: payload.idToken, refreshToken: payload.refreshToken, subject: payload.localId });
  }

  async sendVerificationEmail(idToken, email) {
    if (!validToken(idToken)) throw new FirebaseRequestError('INVALID_ID_TOKEN');
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:sendOobCode?key=${encodeURIComponent(this.apiKey)}`, {
      requestType: 'VERIFY_EMAIL',
      idToken,
      email,
      continueUrl: this.continueUrl,
      canHandleCodeInApp: false
    });
    if (typeof payload?.email !== 'string' || payload.email.trim().toLowerCase() !== String(email || '').trim().toLowerCase()) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({ accepted: true });
  }

  async sendPasswordResetEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || normalized.length > 254 || /[\r\n\u0000]/.test(normalized)) throw new FirebaseRequestError('INVALID_EMAIL');
    const continueUrl = new URL(this.continueUrl);
    continueUrl.searchParams.delete('firebaseVerified');
    continueUrl.searchParams.set('passwordReset', '1');
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:sendOobCode?key=${encodeURIComponent(this.apiKey)}`, {
      requestType: 'PASSWORD_RESET',
      email: normalized,
      continueUrl: continueUrl.href,
      canHandleCodeInApp: false
    });
    if (typeof payload?.email !== 'string' || payload.email.trim().toLowerCase() !== normalized) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({ accepted: true });
  }

  async deleteAccount(idToken) {
    if (!validToken(idToken)) throw new FirebaseRequestError('INVALID_ID_TOKEN');
    await this.#post(`${IDENTITY_TOOLKIT}/accounts:delete?key=${encodeURIComponent(this.apiKey)}`, { idToken });
    return Object.freeze({ deleted: true });
  }

  async signIn(email, password) {
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signInWithPassword?key=${encodeURIComponent(this.apiKey)}`, {
      email, password, returnSecureToken: true
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId)) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      expiresIn: Math.max(60, Number(payload.expiresIn || 3600))
    });
  }

  async #googleSignIn(input, firebaseIdToken = '') {
    const credential = googleCredential(input);
    if (firebaseIdToken && !validToken(firebaseIdToken)) throw new FirebaseRequestError('INVALID_ID_TOKEN');
    const postBody = new URLSearchParams({ [credential.kind]: credential.value, providerId: 'google.com' });
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signInWithIdp?key=${encodeURIComponent(this.apiKey)}`, {
      requestUri: new URL(this.continueUrl).origin,
      postBody: postBody.toString(),
      returnIdpCredential: true,
      returnSecureToken: true,
      autoCreate: !firebaseIdToken,
      ...(firebaseIdToken ? { idToken: firebaseIdToken } : {})
    });
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId) || typeof payload?.email !== 'string' || payload?.emailVerified !== true) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      email: payload.email,
      emailVerified: true,
      isNewUser: payload.isNewUser === true,
      expiresIn: Math.max(60, Number(payload.expiresIn || 3600))
    });
  }

  signInWithGoogle(input) { return this.#googleSignIn(input); }
  linkGoogle(firebaseIdToken, input) { return this.#googleSignIn(input, firebaseIdToken); }

  // Facebook uses the same Identity Toolkit IDP exchange as Google. Facebook's
  // browser flow yields an access_token (not an id_token), so that is the
  // credential kind this path accepts.
  async #facebookSignIn(input, firebaseIdToken = '') {
    const credential = googleCredential(input);
    if (credential.kind !== 'access_token') throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
    if (firebaseIdToken && !validToken(firebaseIdToken)) throw new FirebaseRequestError('INVALID_ID_TOKEN');
    const postBody = new URLSearchParams({ access_token: credential.value, providerId: 'facebook.com' });
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:signInWithIdp?key=${encodeURIComponent(this.apiKey)}`, {
      requestUri: new URL(this.continueUrl).origin,
      postBody: postBody.toString(),
      returnIdpCredential: true,
      returnSecureToken: true,
      autoCreate: !firebaseIdToken,
      ...(firebaseIdToken ? { idToken: firebaseIdToken } : {})
    });
    // Firebase never marks a facebook.com email as verified (Facebook is not an
    // email-trusted IdP), so requiring emailVerified here rejected EVERY
    // Facebook login. The /facebook route proves the address through the Graph
    // API instead, which only returns an email Facebook has confirmed.
    if (!validToken(payload?.idToken) || !validToken(payload?.refreshToken) || !validSubject(payload?.localId) || typeof payload?.email !== 'string' || !payload.email) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      subject: payload.localId,
      email: payload.email,
      emailVerified: payload.emailVerified === true,
      isNewUser: payload.isNewUser === true,
      expiresIn: Math.max(60, Number(payload.expiresIn || 3600))
    });
  }

  signInWithFacebook(input) { return this.#facebookSignIn(input); }
  linkFacebook(firebaseIdToken, input) { return this.#facebookSignIn(input, firebaseIdToken); }

  // Read the verified Facebook identity behind an access token. The Graph API is
  // asked for the app-scoped user id and email; the email is only trusted when
  // Facebook reports it as verified.
  async facebookIdentity(accessToken) {
    if (!validToken(accessToken)) throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
    let response;
    try {
      response = await this.fetch(`${FACEBOOK_GRAPH}/me?fields=id,email&access_token=${encodeURIComponent(accessToken)}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new FirebaseRequestError('NETWORK_ERROR'); }
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.error) throw new FirebaseRequestError('INVALID_IDP_RESPONSE', response.status);
    if (!validSubject(payload?.id) || typeof payload?.email !== 'string' || !payload.email) {
      throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
    }
    return Object.freeze({ subject: String(payload.id), email: payload.email, emailVerified: true });
  }

  async googleIdentity(accessToken) {
    if (!validToken(accessToken)) throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
    let response;
    try {
      response = await this.fetch(GOOGLE_USERINFO, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'Cache-Control': 'no-store' },
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000)
      });
    } catch { throw new FirebaseRequestError('NETWORK_ERROR'); }
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new FirebaseRequestError('INVALID_IDP_RESPONSE', response.status);
    if (!validSubject(payload?.sub) || typeof payload?.email !== 'string' || payload?.email_verified !== true) {
      throw new FirebaseRequestError('INVALID_IDP_RESPONSE');
    }
    return Object.freeze({ subject: payload.sub, email: payload.email, emailVerified: true });
  }

  async lookup(idToken) {
    if (!validToken(idToken)) throw new FirebaseRequestError('INVALID_ID_TOKEN');
    const payload = await this.#post(`${IDENTITY_TOOLKIT}/accounts:lookup?key=${encodeURIComponent(this.apiKey)}`, { idToken });
    const user = Array.isArray(payload?.users) ? payload.users[0] : null;
    if (!user || !validSubject(user.localId) || typeof user.email !== 'string') {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    const providerRows = Array.isArray(user.providerUserInfo) ? user.providerUserInfo : [];
    // displayName/photoUrl come from the VERIFIED Firebase user record (server
    // side, idToken-bound), used only to seed a brand-new profile's empty
    // fields. They never overwrite student-owned data.
    return Object.freeze({
      subject: user.localId,
      email: user.email,
      emailVerified: user.emailVerified === true,
      disabled: user.disabled === true,
      displayName: typeof user.displayName === 'string' && user.displayName ? user.displayName : null,
      photoUrl: typeof user.photoUrl === 'string' && user.photoUrl ? user.photoUrl : null,
      providers: Object.freeze(providerRows.map(row => String(row?.providerId || '')).filter(Boolean)),
      googleSubjects: Object.freeze(providerRows
        .filter(row => row?.providerId === 'google.com' && validSubject(row?.rawId))
        .map(row => String(row.rawId))),
      facebookSubjects: Object.freeze(providerRows
        .filter(row => row?.providerId === 'facebook.com' && validSubject(row?.rawId))
        .map(row => String(row.rawId)))
    });
  }

  async refresh(refreshToken) {
    if (!validToken(refreshToken)) throw new FirebaseRequestError('INVALID_REFRESH_TOKEN');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    const payload = await this.#post(`${SECURE_TOKEN}?key=${encodeURIComponent(this.apiKey)}`, body, { form: true });
    if (!validToken(payload?.id_token) || !validToken(payload?.refresh_token) || !validSubject(payload?.user_id)) {
      throw new FirebaseRequestError('INVALID_PROVIDER_RESPONSE');
    }
    return Object.freeze({
      idToken: payload.id_token,
      refreshToken: payload.refresh_token,
      subject: payload.user_id,
      expiresIn: Math.max(60, Number(payload.expires_in || 3600))
    });
  }
}

export const __firebaseProviderTest = Object.freeze({ validGoogleClientId, googleIdpFromProject });
