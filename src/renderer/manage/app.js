'use strict';
// ManageView.swift: pick a bot, edit its name / system prompt / context, drop files into its context.
// `bots` is the global exposed by the preload (contextBridge); redeclaring it would be a SyntaxError.
const $ = (id) => document.getElementById(id);

let profiles = [];
let selectedProfileID = null;   // the bot in use
let selection = null;           // the bot being edited
const saveTimers = new Map(); // `${id}:${field}` -> { timer, run }

function flushSaves() {
  for (const { timer, run } of saveTimers.values()) { clearTimeout(timer); run(); }
  saveTimers.clear();
}

function render() {
  const list = $('list');
  list.innerHTML = '';
  for (const p of profiles) {
    // A real button per row, so the row can be picked with the keyboard and accessibility tools (like a native List).
    const li = document.createElement('li');
    li.className = p.id === selection ? 'sel' : '';
    li.innerHTML = '<button type="button" class="row"><span class="n"></span>'
      + (p.id === selectedProfileID ? '<span class="check">✓</span>' : '') + '</button>';
    const row = li.querySelector('.row');
    li.querySelector('.n').textContent = p.name === '' ? 'Untitled' : p.name;
    row.setAttribute('aria-pressed', String(p.id === selection));
    row.onclick = () => { flushSaves(); selection = p.id; render(); };
    list.appendChild(li);
  }
  $('remove').disabled = selection == null || profiles.length <= 1;
  const p = profiles.find((x) => x.id === selection);
  $('empty').hidden = !!p;
  $('editor').hidden = !p;
  if (!p) return;
  for (const k of ['name', 'instructions', 'context']) {
    const el = $(k);
    if (document.activeElement !== el && el.value !== p[k]) el.value = p[k];
  }
  const inUse = p.id === selectedProfileID;
  $('use').textContent = inUse ? 'In use' : 'Use this bot';
  $('use').disabled = inUse;
}

function apply(data) {
  profiles = data.profiles;
  selectedProfileID = data.selectedProfileID;
  if (!profiles.some((p) => p.id === selection)) selection = profiles.some((p) => p.id === selectedProfileID) ? selectedProfileID : profiles[0]?.id ?? null;
  render();
}

for (const k of ['name', 'instructions', 'context']) {
  $(k).addEventListener('input', () => {
    const id = selection;
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    p[k] = $(k).value;
    if (k === 'name') render();
    const key = `${id}:${k}`;
    const prev = saveTimers.get(key);
    if (prev) clearTimeout(prev.timer);
    const run = () => bots.update(id, { [k]: p[k] });
    saveTimers.set(key, { run, timer: setTimeout(() => { saveTimers.delete(key); run(); }, 250) });
  });
}

window.addEventListener('beforeunload', flushSaves);
$('add').onclick = async () => { flushSaves(); selection = await bots.add(); apply(await bots.get()); };
$('remove').onclick = async () => {
  if (selection == null) return;
  await bots.remove(selection);
  const data = await bots.get();
  selection = data.profiles[0]?.id ?? null;
  apply(data);
};
$('use').onclick = () => { if (selection) bots.select(selection); };

async function addFiles(files) {
  if (!selection || !files.length) return;
  const note = await bots.addFiles(selection, files);
  $('note').textContent = note || $('note').textContent;
  apply(await bots.get());
}
$('choose').onclick = async () => addFiles(await bots.choose());
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  addFiles([...e.dataTransfer.files].map((f) => bots.pathForFile(f)).filter(Boolean));
});
// Files dropped elsewhere in the window must not navigate it.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

bots.onProfiles(apply);
bots.get().then(apply);
