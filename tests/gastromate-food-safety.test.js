import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { gastroFoodSafetyAnswer } from '../lib/gastromate-food-safety.js';

describe('GastroMate verified allergen boundary', () => {
  it('never asserts peanut or gluten allergy safety without restaurant verification', () => {
    const reply = gastroFoodSafetyAnswer('Is this burger safe for a peanut allergy?', 'en');
    expect(reply.reply).toContain('cannot verify');
    expect(reply.reply).toContain('restaurant staff');
    expect(reply.reply).toContain('cross-contact');
    expect(reply.recommendedItems).toEqual([]);
    expect(reply.action).toBe(null);
    expect(gastroFoodSafetyAnswer('Is this gluten-free?', 'en').reply).toContain('cannot verify');
  });
  it('answers direct ingredient questions conservatively', () => {
    expect(gastroFoodSafetyAnswer('What ingredients are in this burger?', 'en').reply).toContain('restaurant staff');
    expect(gastroFoodSafetyAnswer('Does this contain egg?', 'en').reply).toContain('cannot verify');
  });
  it('provides translated safety notice in Sinhala and Tamil', () => {
    const si = gastroFoodSafetyAnswer('මට අසාත්මිකතාවක් තියෙනවා', 'si');
    const ta = gastroFoodSafetyAnswer('எனக்கு ஒவ்வாமை இருக்கிறது', 'ta');
    expect(si.reply).toContain('කාර්ය මණ්ඩලයෙන්');
    expect(ta.reply).toContain('ஊழியர்களிடம்');
  });
  it('does not hijack regular egg menu orders or harmless recommendations', () => {
    expect(gastroFoodSafetyAnswer('Order two egg burgers')).toBe(null);
    expect(gastroFoodSafetyAnswer('Can you recommend egg fried rice?')).toBe(null);
    expect(gastroFoodSafetyAnswer('What is the best burger?')).toBe(null);
  });
  it('intercepts food safety questions before any Gemini prompt', () => {
    const server = readFileSync('server.js','utf8');
    const block = server.slice(server.indexOf("app.post('/api/ai/chat'"));
    expect(block.indexOf('gastroFoodSafetyAnswer(message, responseLanguage)')).toBeGreaterThan(0);
    expect(block.indexOf('gastroFoodSafetyAnswer(message, responseLanguage)')).toBeLessThan(block.indexOf('const geminiKey ='));
  });
});
