import {describe,it,expect} from 'vitest';
import {normalizeDiscoveryQuery,matchesRestaurantQuery} from '../apps/customer-web/src/utils/discovery-search.js';

describe('GastroFood accessible and multilingual restaurant search',()=>{
  it('matches name, cuisine, area and category terms regardless of case',()=>{
    const store={name:'Colombo BBQ House',cuisine:'Grilled Chicken',location:'Bambalapitiya',cuisineTag:'bbq'};
    expect(matchesRestaurantQuery(store,'BBQ')).toBe(true);
    expect(matchesRestaurantQuery(store,'grilled bambalapitiya')).toBe(true);
    expect(matchesRestaurantQuery(store,'COLOMBO chicken')).toBe(true);
    expect(matchesRestaurantQuery(store,'Kandy')).toBe(false);
  });
  it('normalizes punctuation and Latin accents without inventing cuisine aliases',()=>{
    expect(normalizeDiscoveryQuery(' Café—Lanka! ')).toBe('cafe lanka');
    expect(matchesRestaurantQuery({name:'Café Lanka'},'cafe')).toBe(true);
    expect(matchesRestaurantQuery({name:'Kottu Place'},'pizza')).toBe(false);
  });
  it('retains Sinhala and Tamil Unicode text and handles null or empty input',()=>{
    expect(matchesRestaurantQuery({name:'කෑම කඩේ',location:'කොළඹ'},'කෑම')).toBe(true);
    expect(matchesRestaurantQuery({name:'தமிழ் உணவகம்'},'தமிழ்')).toBe(true);
    expect(matchesRestaurantQuery(null,'')).toBe(true);
    expect(matchesRestaurantQuery(null,'rice')).toBe(false);
  });
});
