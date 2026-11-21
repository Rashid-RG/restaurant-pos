import {describe,it,expect} from 'vitest';
import {gastroConversationPreferences,gastroContextualSuggestions} from '../lib/gastromate-conversation.js';
import {readFileSync} from 'node:fs';

const menu=[
 {id:'burger',name:'Spicy Chicken Burger',price:1400,category:'Burgers',dietaryTags:'spicy',stock:5,isAvailable:1},
 {id:'veg',name:'Veg Rice',price:850,category:'Rice',dietaryTags:'vegetarian',stock:5,isAvailable:1},
 {id:'vegan',name:'Vegan Rice',price:1050,category:'Rice',dietaryTags:'vegan',stock:7,isAvailable:1},
 {id:'lime',name:'Lime Juice',price:350,category:'Drinks',stock:4,isAvailable:1},
 {id:'cola',name:'Cola Drink',price:500,category:'Drinks',stock:8,isAvailable:1},
 {id:'sold',name:'Out of Stock Juice',price:100,category:'Drinks',stock:0,isAvailable:1},
 {id:'hidden',name:'Hidden Rice',price:200,category:'Rice',stock:5,isAvailable:0}
];

describe('GastroMate multi-turn verified menu intelligence',()=>{
 it('finds currently available drinks under a stated budget',()=>{
  const answer=gastroContextualSuggestions(menu,'show drinks under Rs 400');
  expect(answer.prefs.budget).toBe(400);
  expect(answer.items.map(x=>x.id)).toEqual(['lime']);
 });
 it('remembers a previously expressed budget in a short follow-up',()=>{
  const history=[{role:'user',content:'Show meals under Rs 1000'}];
  const answer=gastroContextualSuggestions(menu,'What about drinks?',history);
  expect(answer.prefs.budget).toBe(1000);
  expect(answer.items.map(x=>x.id)).toEqual(['lime','cola']);
 });
 it('updates the budget when a later user request overrides it',()=>{
  const history=[{role:'user',content:'Show meals under 1000'}];
  expect(gastroContextualSuggestions(menu,'Show drinks under 400',history).items.map(i=>i.id)).toEqual(['lime']);
 });
 it('never invents vegan status for vegetarian food',()=>{
  const answer=gastroContextualSuggestions(menu,'Show vegan rice');
  expect(answer.items.map(i=>i.id)).toEqual(['vegan']);
  expect(answer.items.some(i=>i.id==='veg')).toBe(false);
 });
 it('handles cheaper follow-ups without recommending sold out items',()=>{
  const history=[{role:'user',content:'Show drinks'}];
  const answer=gastroContextualSuggestions(menu,'Something cheaper',history);
  expect(answer.items.map(i=>i.id)).toEqual(['lime','cola']);
  expect(answer.items.every(i=>i.stock>0)).toBe(true);
 });
 it('does not treat explicit cart or checkout actions as recommendations',()=>{
  expect(gastroConversationPreferences('order 2 burgers')).toBe(null);
  expect(gastroConversationPreferences('checkout now')).toBe(null);
  expect(gastroContextualSuggestions(menu,'hello')).toBe(null);
 });
 it('keeps dietary filters only for short follow-ups',()=>{
  const history=[{role:'user',content:'Suggest vegan food'}];
  expect(gastroContextualSuggestions(menu,'What about rice?',history).items.map(i=>i.id)).toEqual(['vegan']);
  expect(gastroContextualSuggestions(menu,'Show rice',history).items.map(i=>i.id)).toEqual(['veg','vegan']);
 });
 it('cannot recommend other tenants items not present in the scoped menu',()=>{
  const answer=gastroContextualSuggestions(menu,'Show cheap meals');
  expect(answer.items.some(i=>i.id==='another-shop')).toBe(false);
  expect(answer.items.some(i=>i.id==='hidden')).toBe(false);
 });
 it('routes verified recommendations before the LLM',()=>{
  const server=readFileSync('server.js','utf8');
  const chat=server.slice(server.indexOf("app.post('/api/ai/chat'"));
  expect(chat.indexOf('gastroContextualSuggestions(menuItems, message, recentHistory)'))
    .toBeLessThan(chat.indexOf('const geminiKey ='));
  expect(chat).toContain('recommendedItems: contextual.items');
 });
});
