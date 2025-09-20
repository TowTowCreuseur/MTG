// Génère public/fr-index.min.json à partir des impressions FR chez Scryfall
// Usage: node scripts/build-fr-index.mjs
import fs from 'node:fs/promises';

const OUT = 'public/fr-index.min.json';
const START = 'https://api.scryfall.com/cards/search?order=name&unique=prints&q='
  + encodeURIComponent('lang:fr');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s||'')
  .normalize('NFD').replace(/\p{Diacritic}/gu,'')
  .replace(/[’']/g,"'")
  .toLowerCase().trim().replace(/\s+/g,' ');

const map = new Map(); // key (printed_name normalized) -> Set(oracle_id)

async function crawl(url) {
  for (let page=1; url; page++) {
    process.stdout.write(`\rFetching FR prints page ${page}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    for (const c of (data.data || [])) {
      const printed = c.printed_name || c.card_faces?.[0]?.printed_name;
      const oracle = c.oracle_id;
      if (!printed || !oracle) continue;
      const k = norm(printed);
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(oracle);
    }

    url = data.next_page || null;
    await sleep(120); // douceur pour l’API
  }
  process.stdout.write('\n');
}

async function main() {
  await crawl(START);
  const obj = {};
  for (const [k, set] of map) obj[k] = Array.from(set);
  await fs.mkdir('public', { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(obj), 'utf8');
  console.log(`OK: écrit ${OUT} (${Object.keys(obj).length} entrées)`);
}

main().catch(e => { console.error(e); process.exit(1); });
