/**
 * 파일 저장 공용 유틸 (WAV / MIDI 내보내기에서 공유)
 */

/** 제목을 파일명으로 쓸 수 있게 정리 (영문 소문자·숫자·한글·-_ 만 남김) */
export function safeFileName(title, fallback = 'flow-beat') {
  const name = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name || fallback;
}

/** Blob 을 브라우저 다운로드로 저장 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 일부 브라우저에서 즉시 revoke 하면 다운로드가 취소될 수 있어 지연 해제
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
