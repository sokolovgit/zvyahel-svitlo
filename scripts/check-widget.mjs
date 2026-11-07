// Runs scriptable/svitlo.js in Node against stubbed Scriptable APIs and local data/*.json.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const schedule = JSON.parse(read("data/schedule.json"));

const stub = () =>
  new Proxy(function () {}, {
    get: (t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "stub" : stub()),
    apply: () => stub(),
    construct: () => stub(),
    set: () => true,
  });

const files = new Map();
let settings = { subqueue: "4.2", address: "test" };
Object.assign(globalThis, {
  Color: Object.assign(function Color() {}, { white: () => ({}) }),
  ListWidget: stub(),
  LinearGradient: stub(),
  Point: stub(),
  Size: stub(),
  Rect: stub(),
  Path: stub(),
  DrawContext: stub(),
  Font: stub(),
  SFSymbol: stub(),
  UITable: stub(),
  UITableRow: stub(),
  Alert: stub(),
  URLScheme: stub(),
  Script: stub(),
  args: { widgetParameter: null },
  config: { runsInWidget: false },
  FileManager: {
    local: () => ({
      libraryDirectory: () => "/lib",
      joinPath: (a, b) => `${a}/${b}`,
      fileExists: (p) => p === "/lib/zvyahel-svitlo" || files.has(p) || (p.endsWith("settings.json") && settings),
      createDirectory: () => {},
      readString: (p) => (p.endsWith("settings.json") ? JSON.stringify(settings) : files.get(p)),
      writeString: (p, v) => files.set(p, v),
      modificationDate: () => new Date(0),
    }),
  },
  Request: class {
    constructor(url) {
      this.url = url;
      this.response = { statusCode: 200 };
    }
    async loadJSON() {
      return JSON.parse(read(`data/${this.url.split("/").pop()}`));
    }
  },
});

let api;
globalThis.__SVITLO_TEST__ = (x) => (api = x);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction(read("scriptable/svitlo.js"))();

const { analyze, describe, hhmm, norm, normHouse, render, settingsFromParameter } = api;

assert.equal(hhmm(0), "00:00");
assert.equal(hhmm(1440 + 90), "01:30");
assert.equal(hhmm(-30), "23:30");
assert.equal(norm("вул. Шевченка"), "шевченка");
assert.equal(normHouse("22-А"), normHouse("22а"));
assert.deepEqual(settingsFromParameter(" 3,2 "), { subqueue: "3.2", address: null });
assert.equal(settingsFromParameter("7.1"), null);

const date = schedule.days.at(-1).date;
const fake = {
  days: [{ date, queues: Object.fromEntries(Object.keys(schedule.days[0].queues).map((q) => [q, "0".repeat(14) + "1".repeat(8) + "0".repeat(26)])) }],
};
const at = (minutes) => analyze(fake, "1.1", { date, minutes });

let a = at(8 * 60);
assert.equal(a.state, "1");
assert.deepEqual([a.current.from, a.current.to], [420, 660]);
assert.equal(describe(a).big, "07:00 – 11:00");
assert.equal(a.nextChangeMin, 660);

a = at(5 * 60);
assert.equal(a.state, "0");
assert.equal(describe(a).big, "07:00 – 11:00");
assert.equal(describe(a).sub, "Світло до 07:00");

a = at(12 * 60);
assert.equal(describe(a).label, "Відключень не заплановано");
assert.equal(describe(a).big, "до кінця графіка");

assert.equal(analyze({ days: [] }, "1.1", { date, minutes: 600 }).state, "?");

for (const family of ["small", "medium", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"]) {
  await render(family);
}
settings = { subqueue: null, address: "fixed" };
await render("medium");
await render("accessoryInline");

const real = analyze(schedule, "4.2", api.kyivNow());
console.log("4.2 now:", describe(real));
console.log("widget check passed");
