import { getImage } from 'astro:assets';
import type { Photo } from './recipes';

/**
 * Подбира ширини от общата стълбица, които не надвишават оригинала (без увеличаване).
 * Ако оригиналът е по-малък от най-голямата стъпка, добавя и неговата ширина (освен ако е почти същата).
 * Малкият брой различни ширини държи dist/ малък – всички места ползват една и съща стълбица.
 */
export function fitWidths(ladder: number[], max: number): number[] {
  const fit = ladder.filter((w) => w <= max).sort((a, b) => a - b);
  const top = fit[fit.length - 1];
  if (!top) return [max];
  if (top < max && top < ladder[ladder.length - 1] && max / top > 1.1) fit.push(max);
  return fit;
}

/** Атрибути за увеличения изглед (лайтбокс) – само оптимизирани файлове, никога оригиналът. */
export async function lightboxData(photo: Photo) {
  const max = photo.image.width;
  const widths = fitWidths([800, 1120, 1600], max);
  const set = async (format: 'avif' | 'webp' | 'jpeg') => {
    const img = await getImage({ src: photo.image, widths, format, width: widths[widths.length - 1] });
    return { srcset: img.srcSet.attribute, src: img.src, width: img.attributes.width as number, height: img.attributes.height as number };
  };
  const [avif, webp, jpeg] = await Promise.all([set('avif'), set('webp'), set('jpeg')]);
  return { avif: avif.srcset, webp: webp.srcset, jpeg: jpeg.srcset, href: webp.src, width: jpeg.width, height: jpeg.height };
}

/** Три съотношения (1:1, 4:3, 16:9), както препоръчва Google за Recipe; без увеличаване над оригинала. */
export async function schemaImages(photo: Photo, site: URL | undefined): Promise<string[]> {
  const { width: sw, height: sh } = photo.image;
  const ratios: Array<[number, number]> = [[1, 1], [4, 3], [16, 9]];
  const urls: string[] = [];
  for (const [rw, rh] of ratios) {
    let w = Math.min(1200, sw);
    let h = Math.round((w * rh) / rw);
    if (h > sh) { h = sh; w = Math.round((h * rw) / rh); }
    const img = await getImage({ src: photo.image, width: w, height: h, fit: 'cover', format: 'jpeg' });
    urls.push(new URL(img.src, site).href);
  }
  return urls;
}

/** Оптимизирана снимка (JPEG) за стъпка в структурираните данни. */
export async function stepImageUrl(photo: Photo, site: URL | undefined): Promise<string> {
  const w = Math.min(1000, photo.image.width);
  const img = await getImage({ src: photo.image, width: w, format: 'jpeg' });
  return new URL(img.src, site).href;
}

/** Малка квадратна миниатюра за резултатите от търсенето. */
export async function thumbUrl(photo: Photo): Promise<string> {
  const img = await getImage({ src: photo.image, width: 192, height: 192, fit: 'cover', format: 'webp' });
  return img.src;
}

/** Картинка за Open Graph (1200×630 или най-голямата възможна, JPEG). */
export async function ogImage(photo: Photo, site: URL | undefined) {
  const w = Math.min(1200, photo.image.width);
  const h = Math.round((w * 630) / 1200);
  const img = await getImage({ src: photo.image, width: w, height: h, fit: 'cover', format: 'jpeg' });
  return { url: new URL(img.src, site).href, width: w, height: h };
}
