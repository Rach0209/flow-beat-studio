/**
 * 브라우저 호환성 점검 (classic script — ES Module 미지원 브라우저에서도 실행됨)
 *
 * 1) 필수 Web 플랫폼 기능이 없으면 경고 배너를 표시합니다.
 * 2) main.js(ES Module)가 문법 오류 등으로 로드에 실패해 `window.__fbsReady`가
 *    설정되지 않은 경우에도 배너를 표시합니다.
 *
 * CSP(script-src 'self')를 지키기 위해 인라인 스크립트 대신 외부 파일로 둡니다.
 */
(function () {
  'use strict';

  function missingFeatures() {
    var missing = [];
    if (!('noModule' in HTMLScriptElement.prototype)) missing.push('ES Modules');
    if (!(window.AudioContext || window.webkitAudioContext)) missing.push('Web Audio API');
    if (typeof window.OfflineAudioContext === 'undefined') missing.push('OfflineAudioContext');
    if (typeof window.structuredClone !== 'function') missing.push('structuredClone');
    return missing;
  }

  function showWarning(message) {
    var el = document.getElementById('compatWarning');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var missing = missingFeatures();
    if (missing.length) {
      showWarning(
        '이 브라우저는 필요한 기능(' + missing.join(', ') + ')을 지원하지 않습니다. ' +
          '최신 Chrome / Edge / Safari / Firefox 로 접속해 주세요.'
      );
    }
  });

  window.addEventListener('load', function () {
    // ES Module은 defer 처럼 load 이전에 실행 완료되므로, 이 시점에 준비 플래그가 없으면 로드 실패.
    window.setTimeout(function () {
      if (!window.__fbsReady && missingFeatures().length === 0) {
        showWarning('앱을 시작하지 못했습니다. 브라우저를 최신 버전으로 업데이트하거나 새로고침해 주세요.');
      }
    }, 0);
  });
})();
