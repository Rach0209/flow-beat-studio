/**
 * 보안·견고성 유틸리티
 * - localStorage 안전 접근 (Safari 비공개 모드·저장소 차단 시 예외 방지)
 * - 외부/저장소 유래 값 검증 (모델 ID, API 키 형식, 사용자 프로필)
 * - 타임아웃이 있는 fetch
 */

// ---------- 안전한 localStorage ----------
export const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 저장소를 쓸 수 없는 환경: 무시 */
    }
  },
};

// ---------- 검증 ----------
export const DEFAULT_MODEL = 'gemini-3.8-flash';

/** URL 경로에 삽입되는 값이므로 허용 문자를 엄격히 제한 (경로 조작 방지) */
export function isValidModelId(model) {
  return typeof model === 'string' && /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/.test(model) && !model.includes('..');
}

/**
 * HTTP 헤더 값으로 쓰이므로 인쇄 가능한 ASCII 이면서 공백이 없어야 합니다.
 * (그 외 문자가 있으면 fetch가 TypeError를 던지고 키가 오류 메시지에 섞일 수 있음)
 */
export function isValidApiKeyFormat(key) {
  return typeof key === 'string' && /^[\x21-\x7E]{20,256}$/.test(key);
}

function isGoogleUserContentUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com'));
  } catch {
    return false;
  }
}

/**
 * localStorage / 디코딩된 JWT 에서 온 프로필은 신뢰하지 않고 형태·길이·URL 을 정규화합니다.
 * (표시 전용 데이터이며 인증/권한 판단에 사용하지 않습니다)
 */
export function sanitizeUserProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
  const email = typeof raw.email === 'string' ? raw.email.trim().slice(0, 254) : '';
  if (!name && !email) return null;
  return {
    name: name || email,
    email,
    picture: typeof raw.picture === 'string' && isGoogleUserContentUrl(raw.picture) ? raw.picture : '',
  };
}

export function clampText(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

// ---------- 네트워크 ----------
/** 응답이 없을 때 UI가 무한 대기하지 않도록 타임아웃을 건 fetch */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`요청 시간 초과 (${Math.round(timeoutMs / 1000)}초)`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
