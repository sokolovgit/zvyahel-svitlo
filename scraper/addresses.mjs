import { writeFile } from "node:fs/promises";
import { REM_ID, SETTLEMENT_ID, fetchPage, parseAddressRows, parseStreetOptions } from "./ztoe.mjs";

const OUT = new URL("../data/addresses.json", import.meta.url);
const DELAY_MS = 400;

const streets = parseStreetOptions(await fetchPage({ rem_id: REM_ID, naspunkt_id: SETTLEMENT_ID }));
console.log(`${streets.length} streets`);

const result = [];
for (const [i, { id, name }] of streets.entries()) {
  const rows = parseAddressRows(await fetchPage({ rem_id: REM_ID, naspunkt_id: SETTLEMENT_ID, vulica_id: id }));
  const entries = rows.filter((r) => r.street === name).map(({ houses, subqueue, household }) => ({ houses, subqueue, household }));
  if (entries.length) result.push({ name, entries });
  if ((i + 1) % 50 === 0) console.log(`${i + 1}/${streets.length}`);
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

if (result.length < streets.length * 0.5) throw new Error(`Only ${result.length}/${streets.length} streets have data, refusing to overwrite`);

result.sort((a, b) => a.name.localeCompare(b.name, "uk"));
await writeFile(OUT, JSON.stringify({ city: "Звягель", streets: result }) + "\n");
console.log(`Addresses written: ${result.length} streets`);
