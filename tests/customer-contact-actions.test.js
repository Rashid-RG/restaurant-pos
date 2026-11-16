import {describe,it,expect} from 'vitest';
import {normalizeContactPhone,contactLinks} from '../apps/customer-web/src/utils/contact-actions.js';

describe('GastroFood safe restaurant and rider contact links',()=>{
  it('accepts Sri Lankan local and international numbers',()=>{
    expect(contactLinks('077 123 4567')).toEqual({tel:'tel:0771234567',whatsapp:'https://wa.me/94771234567'});
    expect(contactLinks('+94 77 123 4567')).toEqual({tel:'tel:+94771234567',whatsapp:'https://wa.me/94771234567'});
  });
  it('never guesses an unknown national dialing code',()=>{
    expect(contactLinks('2125550123')).toEqual({tel:'tel:2125550123',whatsapp:null});
    expect(contactLinks('+1 (212) 555-0123')).toEqual({tel:'tel:+12125550123',whatsapp:'https://wa.me/12125550123'});
  });
  it('rejects script-like, nonexistent and short values instead of rendering links',()=>{
    for(const value of [null,'','123','tel:0771234567','javascript:alert(1)','0771234567?x=1','+','+94+771234567']){
      expect(normalizeContactPhone(value)).toBeNull();
      expect(contactLinks(value)).toBeNull();
    }
  });
});
