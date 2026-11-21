import {describe,it,expect} from 'vitest';
import {gastroVoiceLocale,gastroSpeechText,gastroVoiceForLocale} from '../apps/customer-web/src/utils/gastromate-voice.js';

describe('GastroMate browser voice safeguards',()=>{
 it('recognizes Sinhala, Tamil and English language settings',()=>{
  expect(gastroVoiceLocale('si')).toBe('si-LK');
  expect(gastroVoiceLocale('ta')).toBe('ta-LK');
  expect(gastroVoiceLocale('en')).toBe('en-LK');
  expect(gastroVoiceLocale('unknown')).toBe('en-LK');
 });
 it('recognizes the script of the actual assistant reply',()=>{
  expect(gastroVoiceLocale('en','මට බත් ඕන')).toBe('si-LK');
  expect(gastroVoiceLocale('en','எனக்கு சோறு வேண்டும்')).toBe('ta-LK');
  expect(gastroVoiceLocale('si','Burger please')).toBe('si-LK');
 });
 it('strips unsafe links and truncates long read-aloud responses',()=>{
  const text=gastroSpeechText('**Order ready** https://example.com/secret #ok');
  expect(text).not.toContain('https');
  expect(text).toContain('Order ready');
  expect(gastroSpeechText('x'.repeat(2000)).length).toBeLessThanOrEqual(900);
 });
 it('prefers a matching installed browser voice and degrades safely',()=>{
  const voices=[{lang:'en-US',name:'English'},{lang:'ta-IN',name:'Tamil'},{lang:'si-LK',name:'Sinhala'}];
  expect(gastroVoiceForLocale(voices,'si-LK').name).toBe('Sinhala');
  expect(gastroVoiceForLocale(voices,'ta-LK').name).toBe('Tamil');
  expect(gastroVoiceForLocale(voices,'fr-FR')).toBe(null);
  expect(gastroVoiceForLocale(null,'en-LK')).toBe(null);
 });
});
