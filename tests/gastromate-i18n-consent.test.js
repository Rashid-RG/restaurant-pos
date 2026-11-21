import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {gastroLanguage,gastroMessage,gastroPlanIntro} from '../lib/gastromate-i18n.js';

describe('GastroMate localized safe replies',()=>{
  it('accepts configured languages and detects local scripts when unspecified',()=>{
    expect(gastroLanguage('en-LK')).toBe('en');
    expect(gastroLanguage('si')).toBe('si');
    expect(gastroLanguage('ta-LK')).toBe('ta');
    expect(gastroLanguage('', 'ආහාර ඕන')).toBe('si');
    expect(gastroLanguage('', 'உணவு வேண்டும்')).toBe('ta');
    expect(gastroLanguage('evil','hey')).toBe('en');
  });
  it('has meaningful translated support and private-tracking templates',()=>{
    for(const lang of ['en','si','ta']) {
      for(const key of ['preview','partial','within','exceeded','unknown','closed','private']) {
        expect(gastroMessage(lang,key).length).toBeGreaterThan(20);
      }
    }
    expect(gastroMessage('si','private')).not.toBe(gastroMessage('en','private'));
    expect(gastroMessage('ta','closed')).not.toBe(gastroMessage('en','closed'));
  });
  it('does not imply food was added to the cart when only preview exists',()=>{
    const plan={lines:[{status:'available'}],budget:4500,withinBudget:true};
    expect(gastroPlanIntro(plan,'en')).toContain('No items have been added yet');
    expect(gastroPlanIntro({...plan,lines:[{status:'clarify'}],withinBudget:null},'ta'))
      .toContain(gastroMessage('ta','unknown'));
    expect(gastroPlanIntro({...plan,withinBudget:false},'si')).toContain(gastroMessage('si','exceeded'));
  });
  it('passes selected app language to server, not AI-invented translations',()=>{
    const server=readFileSync('server.js','utf8');
    const client=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
    expect(server).toContain('gastroPlanIntro(multiPlan, responseLanguage)');
    expect(server).toContain('gastroMessage(responseLanguage');
    expect(client).toContain('language: lang,');
  });
  it('requires human consent for support tickets and shows guest cancel option',()=>{
    const client=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
    expect(client).toContain('setPendingSupport({text:queryText');
    expect(client).toContain('onClick={confirmSupportRequest}');
    expect(client).toContain('Confirm support request');
    expect(client).toContain('Cancel support request');
    expect(client).not.toContain('// Logged in customer: automatically create real support ticket');
  });
  it('uses speaking and celebration states with reduced-motion CSS',()=>{
    const client=readFileSync('apps/customer-web/src/components/GastroAiConcierge.jsx','utf8');
    const css=readFileSync('apps/customer-web/src/components/gastromate-mascot.css','utf8');
    expect(client).toContain('utterance.onstart = () => setSpeaking(true)');
    expect(client).toContain('utterance.onend = () => setSpeaking(false)');
    expect(client).toContain('celebrate();');
    expect(css).toContain('.gastromate-burger-celebrate');
    expect(css).toContain('prefers-reduced-motion:reduce');
  });
});
