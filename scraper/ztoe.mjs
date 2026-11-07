const BASE = "https://www.ztoe.com.ua/unhooking-search.php";
export const REM_ID = 16;
export const SETTLEMENT_ID = 16823;

const decoder = new TextDecoder("windows-1251");

export async function fetchPage(form) {
  const init = { headers: { "User-Agent": "zvyahel-svitlo (+https://github.com/sokolovgit/zvyahel-svitlo)" } };
  if (form) {
    init.method = "POST";
    init.body = new URLSearchParams(form);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(BASE, { ...init, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decoder.decode(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const stripTags = (s) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const isoDate = (dmy) => {
  const [d, m, y] = dmy.split(".");
  return `${y}-${m}-${d}`;
};

const CELL_STATE = { ffffff: "0", ff3333: "1", ff0000: "1" };

export function parseSchedule(html) {
  const updated = html.match(/Дата оновлення інформації\s*-\s*(\d{2}:\d{2})\s+(\d{2}\.\d{2}\.\d{4})/);
  const notice = html.match(/<h3>УВАГА!([\s\S]*?)Пошук черги/);
  const noticeLines = notice
    ? stripTags(notice[1]).split("\n").map((l) => l.trim()).filter((l) => /^з \d/.test(l) || /^На \d/.test(l))
    : [];

  const dateHeader = /colspan="48"><b[^>]*>(\d{2}\.\d{2}\.\d{4})<\/b>/g;
  const headers = [...html.matchAll(dateHeader)];
  const days = headers.map((h, i) => {
    const section = html.slice(h.index, headers[i + 1]?.index ?? html.length);
    const labels = [...section.matchAll(/<b style="font-size:12pt;color:black;">(\d\.\d)<\/b>/g)];
    const queues = {};
    labels.forEach((l, j) => {
      const row = section.slice(l.index, labels[j + 1]?.index ?? section.length);
      const cells = [...row.matchAll(/text-align:center;border-top[^"]*background: #([0-9a-fA-F]{6})/g)].slice(0, 48);
      if (cells.length !== 48) throw new Error(`Subqueue ${l[1]} on ${h[1]}: expected 48 cells, got ${cells.length}`);
      queues[l[1]] = cells
        .map(([, hex]) => {
          const state = CELL_STATE[hex.toLowerCase()];
          if (!state) throw new Error(`Unknown cell colour #${hex} in ${l[1]}`);
          return state;
        })
        .join("");
    });
    if (Object.keys(queues).length !== 12) throw new Error(`Expected 12 subqueues on ${h[1]}, got ${Object.keys(queues).length}`);
    return { date: isoDate(h[1]), queues };
  });

  if (!days.length) throw new Error("No schedule tables found");
  return {
    source: BASE,
    updatedAt: updated ? `${isoDate(updated[2])}T${updated[1]}` : null,
    notice: noticeLines,
    days,
  };
}

export function parseStreetOptions(html) {
  const select = html.match(/<select name="vulica_id"[\s\S]*?<\/select>/);
  if (!select) throw new Error("Street selector not found");
  return [...select[0].matchAll(/<option value="(\d+)"[^>]*>([^<]+)/g)]
    .filter(([, id]) => id !== "0")
    .map(([, id, name]) => ({ id: Number(id), name: name.trim() }));
}

const NO_OUTAGE = "В цей час не вимикається";

export function parseAddressRows(html) {
  const rows = [...html.matchAll(/<tr><td align="center">Звягельський<\/td>([\s\S]*?)<\/tr>/g)];
  return rows.map(([, body]) => {
    const cols = [...body.matchAll(/<td align="center">([\s\S]*?)<\/td>/g)].map(([, c]) => stripTags(c).trim());
    const [, street, houses, queue, subqueue, note] = cols;
    const fixed = queue.startsWith(NO_OUTAGE);
    return {
      street,
      houses,
      subqueue: fixed ? null : `${queue}.${subqueue}`,
      household: !/непобутов/.test(note ?? ""),
    };
  });
}
