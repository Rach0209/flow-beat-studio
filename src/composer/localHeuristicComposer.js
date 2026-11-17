import { GENRE_PRESETS } from '../data/presets.js';

/**
 * API 키가 미연동 상태이거나 오프라인일 때 동작하는 로컬 키워드 휴리스틱 작곡기
 */
export class LocalHeuristicComposer {
  composeFromPrompt(prompt) {
    const text = (prompt || '').toLowerCase();

    let base = structuredClone(GENRE_PRESETS.lofi);
    if (text.includes('신스') || text.includes('레트로') || text.includes('80') || text.includes('드라이브')) {
      base = structuredClone(GENRE_PRESETS.synthwave);
    } else if (text.includes('우주') || text.includes('몽환') || text.includes('명상') || text.includes('수면')) {
      base = structuredClone(GENRE_PRESETS.ambient);
    } else if (text.includes('시티팝') || text.includes('도쿄') || text.includes('펑키') || text.includes('경쾌')) {
      base = structuredClone(GENRE_PRESETS.citypop);
    } else if (text.includes('테크노') || text.includes('클럽') || text.includes('강렬') || text.includes('빠른')) {
      base = structuredClone(GENRE_PRESETS.techno);
    }

    if (text.includes('비') || text.includes('rain')) {
      base.rain = 45;
      base.cutoff = Math.max(1100, base.cutoff - 300);
    }
    if (text.includes('새벽') || text.includes('밤') || text.includes('차분')) {
      base.bpm = Math.max(66, base.bpm - 6);
      base.reverb = Math.min(80, base.reverb + 12);
    }
    if (text.includes('코딩') || text.includes('집중')) {
      base.vinyl = Math.max(18, base.vinyl);
    }

    base.leadNotes = base.leadNotes.map(() => Math.floor(Math.random() * 8));
    base.title = `Local Vibe: ${prompt.slice(0, 22) || 'Chill Session'}`;
    return base;
  }
}
