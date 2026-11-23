import { expect, test } from 'bun:test';
import { evaluateSheet } from '../../../apps/calculator/evaluate';

const rates = { USD: 1, EUR: 0.9, ARS: 1500 };
const results = (sheet: string) => evaluateSheet(sheet, rates).map((r) => r.text);
const one = (line: string) => results(line)[0];

test('arithmetic, precedence, powers, functions', () => {
  expect(one('2 + 3 * 4')).toBe('14');
  expect(one('(1 + 2)^2')).toBe('9');
  expect(one('2 ** 10')).toBe('1,024');
  expect(one('10 / 4')).toBe('2.5');
  expect(one('-3 + 1')).toBe('-2');
  expect(one('sqrt 16 + 1')).toBe('5');
  expect(one('1,000 * 3')).toBe('3,000');
  expect(one('7 mod 3')).toBe('1');
  expect(one('3 times 4 plus 1')).toBe('13');
});

test('percentages, the way people say them', () => {
  expect(one('15% of 200')).toBe('30');
  expect(one('200 + 10%')).toBe('220');
  expect(one('200 - 25%')).toBe('150');
  expect(one('20% off 50')).toBe('40');
  expect(one('5% on 100')).toBe('105');
  expect(one('12.5%')).toBe('12.5%');
});

test('units convert within the same kind of measure', () => {
  expect(one('20 inches in cm')).toBe('50.8 cm');
  expect(one('5 kg to lb')).toBe('11.0231 lb');
  expect(one('1 mile in km')).toBe('1.6093 km');
  expect(one('100 °F in °C')).toBe('37.7778 °C');
  expect(one('0 celsius in fahrenheit')).toBe('32 °F');
  expect(one('2 hours + 30 min in min')).toBe('150 min');
  expect(one('1.5 GB in MB')).toBe('1,500 MB');
  expect(one('5 in')).toBe('5 in');
  expect(one('5 kg in cm')).toBe('');
});

test('currencies use the given rates; the line can go on after converting', () => {
  expect(one('$20 in eur')).toBe('€ 18.00');
  expect(one('100 usd in ars')).toBe('ARS 150,000.00');
  expect(one('$20 in euro - 5% discount')).toBe('€ 17.10');
  expect(one('€9 + $10')).toBe('€ 18.00');
  expect(one('3000 pesos in usd')).toBe('$ 2.00');
});

test('a sheet: variables, prev, sum, headings, labels, comments, text', () => {
  const sheet = [
    '# Budget',
    'rent = 1200',
    'food = 300',
    'rent + food',
    'prev * 12',
    '',
    'Coffee: 4.5',
    'Lunch: 12 // weekdays',
    'total',
    'just some words',
  ].join('\n');
  expect(results(sheet)).toEqual(['', '1,200', '300', '1,500', '18,000', '', '4.5', '12', '16.5', '']);
});

test('nonsense gives no result instead of a wrong one', () => {
  expect(one('hello world')).toBe('');
  expect(one('2 +')).toBe('');
  expect(one('1 / 0')).toBe('');
  expect(one('5 kg + 3 m')).toBe('');
});
