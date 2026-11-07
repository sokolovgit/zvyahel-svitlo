// Світло · Звягель — https://github.com/sokolovgit/zvyahel-svitlo
// Завантажує актуальну версію віджета з GitHub (раз на 6 год) і запускає її.
const URL = "https://raw.githubusercontent.com/sokolovgit/zvyahel-svitlo/main/scriptable/svitlo.js";
const fm = FileManager.local();
const path = fm.joinPath(fm.libraryDirectory(), "zvyahel-svitlo.js");
const stale = !fm.fileExists(path) || Date.now() - fm.modificationDate(path).getTime() > 6 * 3600 * 1000;
if (stale) {
  try {
    const req = new Request(URL);
    req.timeoutInterval = 10;
    const code = await req.loadString();
    if (req.response.statusCode === 200 && code.includes("Script.complete")) fm.writeString(path, code);
  } catch (e) {}
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await new AsyncFunction(fm.readString(path))();
