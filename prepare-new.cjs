#!/usr/bin/env node
/**
 * prepare-new.cjs
 *
 * Entrée : fichier .txt au format MTGO (exporté depuis Moxfield), ex. :
 *   [Main deck — une carte par ligne : "QTY Nom"]
 *   (1 ligne vide)
 *   [Commander(s) — une carte par ligne : "QTY Nom"]
 *
 * Sortie : JSON "deck prêt à l'emploi" identique à la sortie d'enrich-deck.mjs :
 * {
 *   createdAt, 
 *   cards: [{ id,name,type,imageSmall,imageNormal,qty }, ...],
 *   commanders?: [{ id,name,type,imageSmall,imageNormal }, ...]
 * }
 *
 * Fonctionnalités :
 *  - Parsing du format texte MTGO
 *  - Enrichissement Scryfall (VF prioritaire, sinon VO)
 *  - Budget max 3 s par carte (timeout inclus)
 *  - Barre de progression + "Carte x/n prête."
 *  - Journal des cartes non trouvées (ou hors budget)
 *
 * Usage :
 *   node mtgo-text-to-ready-deck.cjs input.txt output.json
 */

const fs = require("fs");

// ---------- Config Scryfall / limites ----------
const PREFERRED_LANG = "fr";
const PER_CARD_BUDGET_MS = 5000;  // budget max par carte (toutes tentatives incluses)
const REQUEST_TIMEOUT_MS = 5000;  // timeout par requête individuelle
const RATE_DELAY_MS = 80;         // léger délai entre tentatives

// ---------- Utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const deburr = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const ellipsize = (s, n = 40) => (s?.length > n ? s.slice(0, n - 1) + "…" : s || "");

// ---------- Basic lands helpers (PATCH anti-faux positifs "Island" & co) ----------
const BASIC_LAND_SUBTYPES = new Map([
  ["island", "island"], ["ile", "island"], ["île", "island"],
  ["plains", "plains"], ["plaine", "plains"],
  ["swamp", "swamp"], ["marais", "swamp"],
  ["mountain", "mountain"], ["montagne", "mountain"],
  ["forest", "forest"], ["foret", "forest"], ["forêt", "forest"],
]);

function detectBasicSubtype(name) {
  // On retire espaces/accents pour matcher "Île" / "Ile" / "island" / etc.
  const k = deburr(name).replace(/\s+/g, "");
  return BASIC_LAND_SUBTYPES.get(k) || null;
}

async function fetchBasicLandBySubtype(subtype) {
  // Préfère VF, sinon VO. Contraint t:basic + t:<sous-type>
  const base = "https://api.scryfall.com/cards/search?q=";
  const enc = (q) => `${base}${encodeURIComponent(q)}`;

  for (const q of [
    `t:basic t:${subtype} lang:${PREFERRED_LANG}`,
    `t:basic t:${subtype}`,
  ]) {
    const { ok, json } = await fetchWithTimeout(enc(q), REQUEST_TIMEOUT_MS);
    if (ok && json && Array.isArray(json.data) && json.data.length) {
      return normalizeFromScry(json.data[0]);
    }
  }
  return null;
}

// ---------- Progress UI ----------
class ProgressBar {
  constructor(total, { width = 30 } = {}) {
    this.total = Math.max(0, total | 0);
    this.current = 0;
    this.width = width;
    this.startTime = Date.now();
  }
  tick(label = "") {
    this.current = clamp(this.current + 1, 0, this.total);
    this.render(label);
    if (this.current >= this.total) process.stdout.write("\n");
  }
  render(label = "") {
    const ratio = this.total ? this.current / this.total : 1;
    const pct = Math.floor(ratio * 100);
    const filled = Math.round(this.width * ratio);
    const bar = "█".repeat(filled) + "─".repeat(this.width - filled);
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = this.current ? elapsed / this.current : 0;
    const remaining = this.total ? (this.total - this.current) * rate : 0;
    const eta = remaining > 0 ? `${Math.ceil(remaining)}s` : "0s";
    process.stdout.write(
      `\r[${bar}] ${pct.toString().padStart(3)}%  ${this.current}/${this.total}  ETA ${eta}  ${ellipsize(label)}`
    );
  }
}

// ---------- Parsing MTGO ----------
function splitMainAndCommandersFromMTGO(text) {
  // Sépare en 2 blocs : tout jusqu’à la première ligne vide = main deck,
  // après la première ligne vide = commander(s) (toutes lignes non vides).
  const lines = text.split(/\r?\n/);
  let blankIdx = lines.findIndex((l) => l.trim() === "");
  if (blankIdx === -1) blankIdx = lines.length; // pas de commanders

  const mainLines = lines.slice(0, blankIdx).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(blankIdx + 1).map((l) => l.trim());
  const commanderLines = tail.filter((l) => l !== ""); // tolère plusieurs lignes vides
  return { mainLines, commanderLines };
}

function parseMTGOQtyName(line) {
  // Format simple MTGO : "QTY Name"
  // (on ignore tout set/numéro/tag éventuel — MTGO standard ne les inclut pas)
  const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
  if (!m) return null;
  const qty = parseInt(m[1], 10);
  const name = m[2].trim();
  if (!qty || !name) return null;
  return { qty, name };
}

function aggregateByNameMTGO(items) {
  const map = new Map(); // deburr(name) -> { name, qty }
  for (const it of items) {
    const key = deburr(it.name);
    if (!map.has(key)) map.set(key, { name: it.name, qty: 0 });
    map.get(key).qty += it.qty;
  }
  return Array.from(map.values());
}

function parseMTGOTextToDeckPieces(text) {
  const { mainLines, commanderLines } = splitMainAndCommandersFromMTGO(text);

  const mainItems = mainLines.map(parseMTGOQtyName).filter(Boolean);
  const commanderItems = commanderLines.map(parseMTGOQtyName).filter(Boolean);

  const mainAgg = aggregateByNameMTGO(mainItems);
  const commandersAgg = aggregateByNameMTGO(commanderItems).map((c) => c.name); // pour commanders, on ne garde que le nom

  return { mainAgg, commandersAgg };
}

// ---------- Scryfall helpers ----------
async function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, json };
  } catch (e) {
    return { ok: false, json: null, err: e?.name || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function normalizeFromScry(card) {
  const face = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces[0] : null;
  const uris = card.image_uris || face?.image_uris || {};
  const small = uris.small ?? null;
  const normal = uris.normal ?? small;
  return {
    id: card.id,
    name: card.printed_name || card.name || face?.name || null,
    type: card.printed_type_line || card.type_line || face?.type_line || null,
    imageSmall: small,
    imageNormal: normal,
  };
}

async function fetchCardByNamePreferFRThenAny(name) {
  // Cas spécial : terrains de base → évite les faux positifs
  const basic = detectBasicSubtype(name);
  if (basic) {
    const bl = await fetchBasicLandBySubtype(basic);
    if (bl) return bl;
    // En cas d'échec, on continue avec la recherche générique ci-dessous.
  }

  const base = "https://api.scryfall.com/cards/search?order=name&unique=prints&q=";
  const enc = (q) => `${base}${encodeURIComponent(q)}`;

  const queries = [
    `lang:${PREFERRED_LANG} (printed_name:"${name}" OR name:"${name}")`, // FR prioritaire
    `(printed_name:"${name}" OR name:"${name}")`,
    `!"${name}"`,
  ];

  const started = Date.now();
  for (let i = 0; i < queries.length; i++) {
    const elapsed = Date.now() - started;
    const remaining = PER_CARD_BUDGET_MS - elapsed;
    if (remaining <= 0) break;

    const timeoutForThisReq = Math.min(REQUEST_TIMEOUT_MS, remaining);
    const { ok, json } = await fetchWithTimeout(enc(queries[i]), timeoutForThisReq);

    if (ok && json && json.object !== "error" && Array.isArray(json.data) && json.data.length) {
      // Si on cherchait un terrain de base, privilégie un vrai "Basic Land"
      const pick = (() => {
        if (!basic) return json.data[0];
        return json.data.find((c) => {
          const t = (c.printed_type_line || c.type_line || "").toLowerCase();
          return /basic|terrain de base/.test(t) && /land|terrain/.test(t);
        }) || json.data[0];
      })();

      return normalizeFromScry(pick);
    }

    const leftAfter = PER_CARD_BUDGET_MS - (Date.now() - started);
    if (leftAfter > 0) await sleep(Math.min(RATE_DELAY_MS, leftAfter));
  }
  return null;
}

// ---------- Conversion squelette + enrich ----------
function toDeckSkeletonForEnrich(mainAgg, commanderNames) {
  const commanderSet = new Set(commanderNames.map((n) => deburr(n)));
  const commanders = [];
  const cards = [];

  for (const { name, qty } of mainAgg) {
    const base = { id: name, name, type: null, imageSmall: null, imageNormal: null };
    if (commanderSet.has(deburr(name))) {
      commanders.push(base); // si, par erreur, présent aussi dans le main
    } else {
      cards.push({ ...base, qty });
    }
  }

  // Ajoute les commanders absents du main (souvent le cas en MTGO export)
  for (const cname of commanderNames) {
    const key = deburr(cname);
    const alreadyCmd = commanders.some((c) => deburr(c.name) === key);
    const alsoInMain = cards.some((c) => deburr(c.name) === key);
    if (!alreadyCmd && !alsoInMain) {
      commanders.push({ id: cname, name: cname, type: null, imageSmall: null, imageNormal: null });
    }
  }

  const out = { createdAt: new Date().toISOString(), cards };
  if (commanders.length) out.commanders = commanders;
  return out;
}

class DeckEnricher {
  constructor(deck) {
    this.deck = deck;
    this.total =
      (Array.isArray(deck.cards) ? deck.cards.length : 0) +
      (Array.isArray(deck.commanders) ? deck.commanders.length : 0);
    this.bar = new ProgressBar(this.total);
    this.readyCount = 0;
    this.notFound = [];
  }
  onProgress(name, ok) {
    this.bar.tick(`${ok ? "✔" : "✖"} ${name}`);
    if (ok) {
      this.readyCount++;
      process.stdout.write(`  |  Carte ${this.readyCount}/${this.total} prête.`);
    }
  }
  async enrichItems(items) {
    const out = [];
    for (const item of items || []) {
      const wanted = (item.name || item.id || "").trim();
      if (!wanted) {
        out.push(item);
        this.onProgress("", true);
        continue;
      }
      const found = await fetchCardByNamePreferFRThenAny(wanted);
      if (found && (found.imageSmall || found.imageNormal)) {
        out.push({
          id: found.id,
          name: found.name || item.name || wanted,
          type: found.type ?? item.type ?? null,
          imageSmall: found.imageSmall ?? item.imageSmall ?? null,
          imageNormal: found.imageNormal ?? item.imageNormal ?? null,
          ...(item.qty !== undefined ? { qty: item.qty } : {}),
        });
        this.onProgress(wanted, true);
      } else {
        out.push({
          id: item.id,
          name: item.name || wanted,
          type: item.type ?? null,
          imageSmall: item.imageSmall ?? null,
          imageNormal: item.imageNormal ?? null,
          ...(item.qty !== undefined ? { qty: item.qty } : {}),
        });
        this.notFound.push(wanted);
        this.onProgress(wanted, false);
      }
    }
    return out;
  }
  async run() {
    console.log(
      `Enrichissement via Scryfall (format MTGO) — ${this.total} carte(s), budget ${PER_CARD_BUDGET_MS / 1000}s/carte`
    );
    const cards = await this.enrichItems(this.deck.cards || []);
    const commanders = await this.enrichItems(this.deck.commanders || []);
    const out = {
      createdAt: this.deck.createdAt || new Date().toISOString(),
      cards,
      ...(commanders.length ? { commanders } : {}),
    };
    return out;
  }
}

// ---------- Main ----------
(async function main() {
  if (process.argv.length < 4) {
    console.error("Usage: node mtgo-text-to-ready-deck.cjs input.txt output.json");
    process.exit(1);
  }
  const [inFile, outFile] = process.argv.slice(2);

  // 1) Lecture & parsing MTGO
  const raw = fs.readFileSync(inFile, "utf8");
  const { mainAgg, commandersAgg } = parseMTGOTextToDeckPieces(raw);

  if (!mainAgg.length && !commandersAgg.length) {
    console.error("Aucune carte détectée dans le fichier MTGO.");
    process.exit(1);
  }

  // 2) Conversion vers le format d'entrée d'enrich-deck (squelette)
  const skeleton = toDeckSkeletonForEnrich(mainAgg, commandersAgg);

  // 3) Enrichissement Scryfall
  const enricher = new DeckEnricher(skeleton);
  const enriched = await enricher.run();

  // 4) Écriture + logs
  fs.writeFileSync(outFile, JSON.stringify(enriched, null, 2), "utf8");
  console.log(`\n✅ Deck prêt (format enrich-deck) écrit dans ${outFile}`);

  if (enricher.notFound.length) {
    console.log("⚠️  Images non trouvées (ou hors budget) pour :");
    for (const name of enricher.notFound) console.log(" • " + name);
  } else {
    console.log("✅ Toutes les cartes ont une image.");
  }
})().catch((e) => {
  console.error("\n❌ Erreur:", e?.message || e);
  process.exit(1);
});
