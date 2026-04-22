#!/usr/bin/env node
/**
 * enrich-deck.mjs — Ajoute ID + images (VF prioritaire sinon VO) à un deck
 * Usage :
 *   node enrich-deck.mjs input.json  output.json   ← JSON avec champs name/qty
 *   node enrich-deck.mjs input.txt   output.json   ← Format MTGO (ex: "4 Mountain")
 */

import fs from "fs";
import path from "path";

const PREFERRED_LANG = "fr";
const RATE_DELAY_MS = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------- Normalisation carte Scryfall -------- */
function normalizeFromScry(card) {
  const face = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces[0] : null;
  const uris = card.image_uris || face?.image_uris || {};
  const normal = uris.normal ?? uris.small ?? null;
  return {
    id: card.id,
    name: card.printed_name || card.name || face?.name,
    type: card.printed_type_line || card.type_line || face?.type_line,
    imageSmall:  normal,
    imageNormal: normal,
  };
}

/* -------- Fetch Scryfall -------- */
async function fetchCardByNamePreferLang(name) {
  const base = "https://api.scryfall.com/cards/search?order=name&unique=prints&q=";
  const queries = [
    // Recherche exacte EN priorité (évite les faux positifs sur noms courts/terrains de base)
    `lang:${PREFERRED_LANG} !"${name}"`,
    `!"${name}"`,
    // Puis recherche large si exact ne trouve rien
    `lang:${PREFERRED_LANG} (printed_name:"${name}" OR name:"${name}")`,
    `(printed_name:"${name}" OR name:"${name}")`,
  ];
  for (const q of queries) {
    try {
      let res = await fetch(base + encodeURIComponent(q));
      // Rate limit : attendre 2s et réessayer
      if (res.status === 429) {
        await sleep(2000);
        res = await fetch(base + encodeURIComponent(q));
      }
      const json = await res.json();
      if (!res.ok || json.object === "error" || !json.data?.length) continue;
      await sleep(RATE_DELAY_MS);
      return normalizeFromScry(json.data[0]);
    } catch { continue; }
  }
  return null;
} (printed_name:"${name}" OR name:"${name}")`,
    `(printed_name:"${name}" OR name:"${name}")`,
    `!"${name}"`,
  ];
  for (const q of queries) {
    try {
      let res = await fetch(base + encodeURIComponent(q));
      // Rate limit : attendre 2s et réessayer
      if (res.status === 429) {
        await sleep(2000);
        res = await fetch(base + encodeURIComponent(q));
      }
      const json = await res.json();
      if (!res.ok || json.object === "error" || !json.data?.length) continue;
      await sleep(RATE_DELAY_MS);
      return normalizeFromScry(json.data[0]);
    } catch { continue; }
  }
  return null;
}

/* -------- Parser format MTGO (.txt) -------- */
function parseMtgoTxt(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const cards = [], commanders = [];
  let inSideboard = false;

  for (const line of lines) {
    if (/^sideboard/i.test(line)) { inSideboard = true; continue; }
    if (inSideboard) continue; // ignorer le sideboard MTGO
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const qty  = parseInt(match[1], 10);
    const name = match[2].trim();
    cards.push({ name, qty });
  }

  // La dernière carte du deck est le commander
  if (cards.length > 0) {
    commanders.push({ ...cards.pop(), qty: 1 });
  }

  return { createdAt: new Date().toISOString(), cards, commanders };
}

/* -------- Enrichissement -------- */
async function enrichItemArray(items) {
  const out = [];
  for (const item of items || []) {
    const wanted = (item.name || item.id || "").trim();
    if (!wanted) { out.push(item); continue; }
    process.stdout.write(`  → ${wanted} (x${item.qty ?? 1})... `);
    const found = await fetchCardByNamePreferLang(wanted);
    if (found) {
      out.push({
        id: found.id, name: found.name, type: found.type,
        imageSmall: found.imageSmall, imageNormal: found.imageNormal,
        qty: item.qty ?? 1,
      });
      console.log("✓");
    } else {
      out.push({ ...item, qty: item.qty ?? 1 });
      console.log("✗ non trouvé");
    }
  }
  return out;
}

async function enrichDeck(deckJson) {
  console.log(`\nDeck principal (${deckJson.cards?.length ?? 0} entrées)...`);
  const cards = await enrichItemArray(deckJson.cards || []);
  const hasCmds = (deckJson.commanders || []).length > 0;
  const commanders = hasCmds
    ? (console.log(`\nCommanders...`), await enrichItemArray(deckJson.commanders))
    : [];
  return {
    createdAt: deckJson.createdAt || new Date().toISOString(),
    cards,
    ...(commanders.length ? { commanders } : {}),
  };
}

/* -------- Main CLI -------- */
if (process.argv.length < 4) {
  console.error("Usage: node enrich-deck.mjs input.json|input.txt output.json");
  process.exit(1);
}

const [inputFile, outputFile] = process.argv.slice(2);
const ext = path.extname(inputFile).toLowerCase();
const rawText = fs.readFileSync(inputFile, "utf8");

let deckJson;
if (ext === ".txt") {
  console.log("Format MTGO détecté — parsing du .txt...");
  deckJson = parseMtgoTxt(rawText);
} else {
  deckJson = JSON.parse(rawText);
}

const totalCards = (deckJson.cards || []).reduce((sum, c) => sum + (c.qty ?? 1), 0);
console.log(`${deckJson.cards?.length ?? 0} entrées — ${totalCards} cartes au total`);

const enriched = await enrichDeck(deckJson);
fs.writeFileSync(outputFile, JSON.stringify(enriched, null, 2));
console.log(`\n✅ Écrit dans ${outputFile}`);
