// Прегледни листове (само за ръчен преглед, не са част от сайта): node sheets.mjs <папка със снимки> <inventory.json> <изход> [на лист=20]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [src = '/src', inv = '/out/inventory.json', outDir = '/out/sheets', perArg = '20'] = process.argv.slice(2);
const per = +perArg, cols = 5, cw = 230, ch = 292, pad = 4;
fs.mkdirSync(outDir, { recursive: true });
const rows = JSON.parse(fs.readFileSync(inv, 'utf8')).filter((r) => !r.exactDuplicateOf);
const esc = (s) => s.replace(/[<>&]/g, '');
let sheetNo = 0;
for (let i = 0; i < rows.length; i += per) {
  const chunk = rows.slice(i, i + per);
  const rowsN = Math.ceil(chunk.length / cols);
  const comps = [];
  for (let k = 0; k < chunk.length; k++) {
    const r = chunk[k];
    const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
    const thumb = await sharp(path.join(src, r.name)).rotate().resize(cw - 2 * pad, ch - 2 * pad - 18, { fit: 'contain', background: '#222' }).jpeg({ quality: 72 }).toBuffer();
    comps.push({ input: thumb, left: x + pad, top: y + pad + 18 });
    const label = `<svg width="${cw}" height="22"><rect width="${cw}" height="20" fill="#000"/><text x="6" y="15" font-family="Liberation Sans" font-size="15" font-weight="bold" fill="#ffd54a">#${r.idx}</text><text x="52" y="15" font-family="Liberation Sans" font-size="11" fill="#fff">b${r.batch} ${esc(r.name).replace(/ChatGPT Image /, '').slice(0, 26)}</text></svg>`;
    comps.push({ input: Buffer.from(label), left: x, top: y });
  }
  sheetNo++;
  await sharp({ create: { width: cols * cw, height: rowsN * ch, channels: 3, background: '#111' } })
    .composite(comps).jpeg({ quality: 70 }).toFile(path.join(outDir, `sheet-${String(sheetNo).padStart(2, '0')}.jpg`));
}
console.log('листове:', sheetNo, 'снимки:', rows.length);
