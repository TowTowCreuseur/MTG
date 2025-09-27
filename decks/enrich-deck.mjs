#!/usr/bin/env node
/**
 * enrich-deck.js — Ajoute ID + images (VF prioritaire sinon VO) à un deck JSON
 * Usage :
 *   node enrich-deck.js input.json output.json
 */

import fs from "fs";

const PREFERRED_LANG = "fr";
const RATE_DELAY_MS = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeFromScry(card) {
  const face = Array.isArray(card.card_faces) && card.card_faces.length ? card.card_faces[0] : null;
  const uris = card.image_uris || face?.image_uris || {};
  const small = uris.small ?? null;
  const normal = uris.normal ?? small;

  return {
    id: card.id,
    name: card.printed_name || card.name || face?.name,
    type: card.printed_type_line || card.type_line || face?.type_line,
    imageSmall: small,
    imageNormal: normal,
  };
}

async function fetchCardByNamePreferLang(name) {
  const base = "https://api.scryfall.com/cards/search?order=name&unique=prints&q=";
  const enc = (q) => `${base}${encodeURIComponent(q)}`;

  const queries = [
    `lang:${PREFERRED_LANG} (printed_name:"${name}" OR name:"${name}")`,
    `(printed_name:"${name}" OR name:"${name}")`,
    `!"${name}"`,
  ];

  for (const q of queries) {
    try {
      const res = await fetch(enc(q));
      const json = await res.json();
      if (!res.ok || json.object === "error" || !json.data?.length) continue;
      await sleep(RATE_DELAY_MS);
      return normalizeFromScry(json.data[0]);
    } catch {
      continue;
    }
  }
  return null;
}

async function enrichItemArray(items) {
  const out = [];
  for (const item of items || []) {
    const wanted = (item.name || item.id || "").trim();
    if (!wanted) {
      out.push(item);
      continue;
    }
    const found = await fetchCardByNamePreferLang(wanted);
    if (found) {
      out.push({
        id: found.id,
        name: found.name,
        type: found.type,
        imageSmall: found.imageSmall,
        imageNormal: found.imageNormal,
        ...(item.qty !== undefined ? { qty: item.qty } : {}),
      });
    } else {
      out.push(item);
    }
  }
  return out;
}

async function enrichDeckJson(deckJson) {
  const cards = await enrichItemArray(deckJson.cards || []);
  const commanders = await enrichItemArray(deckJson.commanders || []);
  return {
    createdAt: deckJson.createdAt || new Date().toISOString(),
    cards,
    ...(commanders.length ? { commanders } : {}),
  };
}

// -------- Main CLI ----------
if (process.argv.length < 4) {
  console.error("Usage: node enrich-deck.js input.json output.json");
  process.exit(1);
}
const [inputFile, outputFile] = process.argv.slice(2);

const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const enriched = await enrichDeckJson(raw);
fs.writeFileSync(outputFile, JSON.stringify(enriched, null, 2));
console.log(`Deck enrichi écrit dans ${outputFile}`);
