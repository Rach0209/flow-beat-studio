/**
 * Google 계정 & AI Studio 무료 API Key 연동 모달 UI 컨트롤러
 */
import { isValidApiKeyFormat } from '../core/security.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class AuthModalView {
  constructor(store, authService, showToast) {
    this.store = store;
    this.authService = authService;
    this.showToast = showToast;

    this.modalEl = document.getElementById('authModal');
    this.openBtn = document.getElementById('openAuthModalBtn');
    this.closeBtn = document.getElementById('closeAuthModalBtn');

    this.apiKeyInput = document.getElementById('geminiApiKeyInput');
    this.modelSelect = document.getElementById('geminiModelSelect');
    this.testSaveBtn = document.getElementById('testSaveApiKeyBtn');
    this.removeKeyBtn = document.getElementById('removeApiKeyBtn');
    this.feedbackEl = document.getElementById('apiTestFeedback');

    this.clientIdInput = document.getElementById('googleClientIdInput');
    this.saveClientIdBtn = document.getElementById('saveClientIdBtn');
    this.signInBox = document.getElementById('googleSignInContainer');
    this.signOutBtn = document.getElementById('googleSignOutBtn');

    this.statusDot = document.getElementById('aiStatusDot');
    this.statusLabel = document.getElementById('aiStatusLabel');
    this.userChip = document.getElementById('userProfileChip');
    this.userAvatar = document.getElementById('userAvatar');
    this.userName = document.getElementById('userName');

    this.lastFocusedEl = null;

    this.#bindEvents();
    this.syncUI();
  }

  /** 모달 열기: 포커스 이동 + 이전 포커스 기억 (WCAG 2.4.3) */
  #open() {
    this.lastFocusedEl = document.activeElement;
    this.syncUI();
    this.modalEl.classList.remove('hidden');
    this.openBtn.setAttribute('aria-expanded', 'true');
    this.apiKeyInput.focus();
  }

  #close() {
    this.modalEl.classList.add('hidden');
    this.openBtn.setAttribute('aria-expanded', 'false');
    if (this.lastFocusedEl && document.contains(this.lastFocusedEl)) {
      this.lastFocusedEl.focus();
    }
  }

  #isOpen() {
    return !this.modalEl.classList.contains('hidden');
  }

  /** Esc 닫기 + Tab 포커스 트랩 */
  #handleKeydown(e) {
    if (!this.#isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.#close();
      return;
    }
    if (e.key !== 'Tab') return;

    const items = [...this.modalEl.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  #bindEvents() {
    this.openBtn.addEventListener('click', () => this.#open());
    this.closeBtn.addEventListener('click', () => this.#close());
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.#close();
    });
    document.addEventListener('keydown', (e) => this.#handleKeydown(e));

    this.testSaveBtn.addEventListener('click', async () => {
      const key = this.apiKeyInput.value.trim();
      const model = this.modelSelect.value;
      if (!isValidApiKeyFormat(key)) {
        this.feedbackEl.className = 'feedback-text err';
        this.feedbackEl.textContent = key
          ? 'API 키 형식이 올바르지 않습니다. (공백·한글 등 허용되지 않는 문자 포함)'
          : 'API 키를 입력해 주세요.';
        return;
      }
      this.testSaveBtn.disabled = true;
      this.feedbackEl.className = 'feedback-text';
      this.feedbackEl.textContent = 'Google AI Studio 무료 티어 연결 테스트 중...';

      const result = await this.authService.verifyGeminiApiKey(key, model);
      this.testSaveBtn.disabled = false;

      if (result.ok) {
        this.store.saveGeminiCredentials(key, model);
        this.feedbackEl.className = 'feedback-text ok';
        this.feedbackEl.textContent = result.message;
        this.showToast('본인 Google AI Studio 무료 계정이 연동되었습니다.');
      } else {
        this.feedbackEl.className = 'feedback-text err';
        this.feedbackEl.textContent = result.message;
      }
    });

    this.removeKeyBtn.addEventListener('click', () => {
      this.apiKeyInput.value = '';
      this.store.saveGeminiCredentials('', this.modelSelect.value);
      this.feedbackEl.className = 'feedback-text';
      this.feedbackEl.textContent = '저장된 API 키가 삭제되었습니다. (로컬 엔진 모드)';
      this.showToast('API 키가 제거되었습니다.');
    });

    this.saveClientIdBtn.addEventListener('click', async () => {
      const clientId = this.clientIdInput.value.trim();
      this.store.saveGoogleClientId(clientId);
      if (clientId) {
        await this.authService.initGoogleSignIn(clientId, this.signInBox);
        this.showToast('Google 로그인 버튼이 활성화되었습니다.');
      } else {
        this.signInBox.innerHTML = '';
      }
    });

    this.signOutBtn.addEventListener('click', () => {
      this.authService.signOut();
      this.showToast('Google 계정에서 로그아웃되었습니다.');
    });
  }

  syncUI() {
    const { geminiApiKey, geminiModel, googleClientId, userProfile } = this.store.state.auth;

    this.apiKeyInput.value = geminiApiKey;
    // 저장된 모델이 현재 목록에 없으면(폐지 등) 첫 항목으로 대체
    const hasOption = [...this.modelSelect.options].some((o) => o.value === geminiModel);
    this.modelSelect.value = hasOption ? geminiModel : this.modelSelect.options[0].value;
    this.clientIdInput.value = googleClientId;

    if (geminiApiKey) {
      this.statusDot.className = 'status-dot online';
      this.statusLabel.textContent = `Gemini 무료 AI 연동됨 (${geminiModel})`;
    } else {
      this.statusDot.className = 'status-dot offline';
      this.statusLabel.textContent = '로컬 모드 (Google 무료 연동)';
    }

    if (userProfile) {
      this.userChip.classList.remove('hidden');
      if (userProfile.picture) {
        this.userAvatar.src = userProfile.picture;
        this.userAvatar.classList.remove('hidden');
      } else {
        this.userAvatar.removeAttribute('src');
        this.userAvatar.classList.add('hidden');
      }
      this.userName.textContent = userProfile.name;
      this.signOutBtn.classList.remove('hidden');
    } else {
      this.userChip.classList.add('hidden');
      this.signOutBtn.classList.add('hidden');
    }

    if (googleClientId && !this.signInBox.hasChildNodes()) {
      this.authService.initGoogleSignIn(googleClientId, this.signInBox).catch(() => {});
    }
  }
}
