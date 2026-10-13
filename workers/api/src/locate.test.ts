import { describe, expect, it } from 'vitest';
import { locateTaluk } from './locate';

describe('locateTaluk', () => {
  it.each([
    ['Kakkanad', 10.0159, 76.3419, 'Ernakulam', 'Kanayannor'],
    ['Thiruvananthapuram city', 8.5241, 76.9366, 'Thiruvananthapuram', 'Thiruvananthapuram'],
    ['Kozhikode city', 11.2588, 75.7804, 'Kozhikode', 'Kozhikode'],
    ['Munnar', 10.0889, 77.0595, 'Idukki', 'Devikulam'],
    ['Kalpetta', 11.6085, 76.083, 'Wayanad', 'Vythiri'],
    ['Aluva', 10.1004, 76.3570, 'Ernakulam', 'Aluva'],
  ])('%s', (_name, lat, lng, district, taluk) => {
    expect(locateTaluk(lat, lng)).toEqual({ district, taluk });
  });

  it('works with coordinates rounded to ~1 km', () => {
    expect(locateTaluk(10.02, 76.34)?.taluk).toBe('Kanayannor');
  });

  it('returns null outside Kerala', () => {
    expect(locateTaluk(12.9716, 77.5946)).toBeNull(); // Bengaluru
    expect(locateTaluk(9.5, 74.5)).toBeNull(); // Arabian Sea
  });
});
