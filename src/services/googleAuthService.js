/**
 * 본인 Google 계정 무료 연동 서비스
 * 1) Google AI Studio 무료 API Key 검증 및 관리
 * 2) Google Identity Services (GIS OAuth 2.0) 로그인 연동
 */
import {
  DEFAULT_MODEL,
  clampText,
  fetchWithTimeout,
  isValidApiKeyFormat,
  isValidModelId,
  sanitizeUserProfile,
} from '../core/security.js';

export class GoogleAuthService {
  constructor(store) {
    this.store = store;
    this.gisLoaded = false;
    this.gisPromise = null;
    this.initializedClientId = null;
  }

  async verifyGeminiApiKey(apiKey, model = DEFAULT_MODEL) {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { ok: false, message: 'API 키를 입력해 주세요.' };
    }
    if (!isValidApiKeyFormat(cleanKey)) {
      return { ok: false, message: 'API 키 형식이 올바르지 않습니다. (공백·한글 등 허용되지 않는 문자 포함)' };
    }
    if (!isValidModelId(model)) {
      return { ok: false, message: '모델 ID 형식이 올바르지 않습니다.' };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent`;

    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with OK' }] }],
          generationConfig: { maxOutputTokens: 8 },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const reason = clampText(errData?.error?.message, 160, `HTTP ${res.status}`);
        return { ok: false, message: `인증 실패: ${reason}` };
      }

      return {
        ok: true,
        message: `연동 성공! (${model} 무료 티어 정상 연결됨)`,
      };
    } catch (err) {
      return {
        ok: false,
        message: `네트워크 오류: ${err.message}`,
      };
    }
  }

  async initGoogleSignIn(clientId, buttonContainerEl) {
    if (!clientId || !buttonContainerEl) return;

    await this.#loadGisScript();
    if (!window.google?.accounts?.id) return;

    // 모달 동기화와 버튼 클릭이 연달아 호출되어도 initialize()는 한 번만 실행
    if (this.initializedClientId === clientId && buttonContainerEl.hasChildNodes()) return;
    this.initializedClientId = clientId;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => this.#handleCredentialResponse(response),
    });

    buttonContainerEl.innerHTML = '';
    window.google.accounts.id.renderButton(buttonContainerEl, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
    });
  }

  signOut() {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    this.store.setUserProfile(null);
  }

  #handleCredentialResponse(response) {
    try {
      const payload = this.#decodeJwtPayload(response.credential);
      // 서버 검증 없이 디코딩한 값이므로 표시용으로만 정규화해 사용합니다.
      const profile = sanitizeUserProfile({
        name: payload.name || payload.email,
        email: payload.email,
        picture: payload.picture || '',
      });
      if (profile) this.store.setUserProfile(profile);
    } catch (e) {
      console.error('JWT 파싱 실패:', e);
    }
  }

  #decodeJwtPayload(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  }

  #loadGisScript() {
    if (this.gisPromise) return this.gisPromise;

    this.gisPromise = new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        this.gisLoaded = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.id = 'google-gsi-sdk';
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.onload = () => {
        this.gisLoaded = true;
        resolve();
      };
      script.onerror = () => {
        this.gisPromise = null; // 재시도 허용
        script.remove();
        reject(new Error('Google GIS SDK 로드 실패'));
      };
      document.head.appendChild(script);
    });
    return this.gisPromise;
  }
}
