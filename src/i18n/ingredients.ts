// Ред със съставка на конкретен език + преоразмеряване на порциите. Ползва се и от сървъра (първоначален текст),
// и от браузъра (смяна на порциите, списък за пазаруване) – еднаква логика на двете места.
import { formatAmount, unitLabel, type Locale } from './index';

/** Съкратен запис на съставка (за JSON в страницата) */
export interface Ing {
  a?: number; // количество
  u?: string; // мерна единица (на езика на записа)
  n: string; // име
  o?: string; // уточнение (в скоби)
  s: boolean; // преоразмерява ли се
}

const SMALL = new Set(['г', 'g', 'мл', 'ml']);
const LARGE = new Set(['кг', 'kg', 'л', 'L']);
const SPOON = new Set(['с. л.', 'ч. л.', 'tbsp', 'tsp']);

/** „Приятно“ закръгляне на преоразмерено количество според мерната единица */
export function nice(v: number, unit: string): number {
  if (SMALL.has(unit)) return v >= 100 ? Math.round(v / 10) * 10 : v >= 20 ? Math.round(v / 5) * 5 : Math.max(1, Math.round(v));
  if (LARGE.has(unit)) return Math.round(v * 20) / 20;
  if (SPOON.has(unit)) return Math.max(0.25, Math.round(v * 4) / 4);
  return Math.max(0.5, Math.round(v * 2) / 2);
}

/** factor = нови порции / базови порции; 1 = оригиналните количества без закръгляне */
export function ingredientLine(locale: Locale, i: Ing, factor = 1): string {
  const scaled = i.a !== undefined && i.s && factor !== 1 ? nice(i.a * factor, i.u ?? '') : i.a;
  const amountText = scaled !== undefined ? formatAmount(locale, scaled) : '';
  const unit = unitLabel(locale, i.u, scaled);
  return [amountText, unit, i.n].filter(Boolean).join(' ') + (i.o ? ` (${i.o})` : '');
}
