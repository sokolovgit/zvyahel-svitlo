import { readFile, writeFile } from "node:fs/promises";
import { fetchPage, parseSchedule } from "./ztoe.mjs";

const OUT = new URL("../data/schedule.json", import.meta.url);
const KEEP_DAYS = 3;

const fresh = parseSchedule(await fetchPage());

let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, "utf8"));
} catch {}

const byDate = new Map((previous?.days ?? []).map((d) => [d.date, d]));
for (const day of fresh.days) byDate.set(day.date, day);
const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP_DAYS);

const next = { ...fresh, days };
const json = JSON.stringify(next, null, 2) + "\n";

if (previous && JSON.stringify(previous, null, 2) + "\n" === json) {
  console.log("Schedule unchanged");
} else {
  await writeFile(OUT, json);
  console.log(`Schedule written: ${days.map((d) => d.date).join(", ")} (updated ${next.updatedAt})`);
}
