// Editing the bots, without the page: which one is open, what isn't saved yet, what to ask the main process.
import type { BotsState, Profile } from './domain';
import type { BotsReply, BotsRequest } from './ipc';

export type BotField = 'name' | 'instructions' | 'context';
export const SAVE_DELAY_MS = 250;

/** By name; all of them when nothing was typed. */
export const searchBots = (profiles: ReadonlyArray<Profile>, typed: string) => {
  const words = typed.trim().toLowerCase();
  return profiles.filter((p) => p.name.toLowerCase().includes(words));
};

export interface BotsView {
  readonly profiles: ReadonlyArray<Profile>;
  readonly inUse: string;
  readonly editing: Profile | undefined;
  /** Delete was pressed once: the next one deletes. */
  readonly removing: boolean;
  readonly note: string;
}

export class BotsEditor {
  private profiles: ReadonlyArray<Profile> = [];
  private inUse = '';
  private editing: string | null = null;
  private removing = false;
  private note = '';
  private asked = 0;
  /** Edits sent and not answered yet. */
  private saving = new Set<Promise<unknown>>();
  private readonly saves = new Map<
    string,
    { readonly timer: ReturnType<typeof setTimeout>; readonly run: () => void }
  >();

  constructor(
    private readonly ask: (request: BotsRequest) => Promise<unknown>,
    private readonly changed: () => void,
    private readonly delay = SAVE_DELAY_MS,
  ) {}

  private request<R extends BotsRequest>(request: R) {
    return this.ask(request) as Promise<BotsReply<R['_tag']>>;
  }

  get view(): BotsView {
    return {
      profiles: this.profiles,
      inUse: this.inUse,
      editing: this.profiles.find((p) => p.id === this.editing),
      removing: this.removing,
      note: this.note,
    };
  }

  async refresh() {
    const mine = ++this.asked;
    const s: BotsState = await this.request({ _tag: 'Get' });
    // A newer question is on its way, or an edit isn't saved yet: this answer is already old.
    if (mine !== this.asked || this.saves.size > 0 || this.saving.size > 0) return;
    this.profiles = s.profiles;
    this.inUse = s.selectedProfileID;
    if (!this.profiles.some((p) => p.id === this.editing))
      this.editing = (this.profiles.find((p) => p.id === this.inUse) ?? this.profiles[0])?.id ?? null;
    this.changed();
  }

  /** The next refresh opens the one in use. */
  showInUse() {
    void this.flush();
    this.editing = null;
    this.removing = false;
    this.note = '';
  }

  open(id: string) {
    void this.flush();
    this.editing = id;
    this.removing = false;
    this.note = '';
    this.changed();
  }

  /** Saved a moment after the last key. */
  edit(field: BotField, value: string) {
    const id = this.editing;
    if (id === null) return;
    this.profiles = this.profiles.map((p) => (p.id === id ? { ...p, [field]: value } : p));
    const key = `${id}:${field}`;
    clearTimeout(this.saves.get(key)?.timer);
    const run = () => {
      this.saves.delete(key);
      const sent = this.request({ _tag: 'Update', id, fields: { [field]: value } })
        .catch(() => undefined)
        .then(() => {
          this.saving.delete(sent);
          // Whatever was ignored meanwhile.
          if (this.saving.size === 0) void this.refresh();
        });
      this.saving.add(sent);
    };
    this.saves.set(key, { run, timer: setTimeout(run, this.delay) });
    this.changed();
  }

  /** Saves everything now. */
  async flush() {
    for (const { timer, run } of [...this.saves.values()]) {
      clearTimeout(timer);
      run();
    }
    await Promise.all(this.saving);
  }

  async add() {
    await this.flush();
    this.editing = await this.request({ _tag: 'Add' });
    this.removing = false;
    await this.refresh();
  }

  async use() {
    if (this.editing === null) return;
    await this.request({ _tag: 'Select', id: this.editing });
    await this.refresh();
  }

  /** It can't be brought back: the first time only asks. */
  async remove() {
    const id = this.editing;
    if (id === null || this.profiles.length <= 1) return;
    if (!this.removing) {
      this.removing = true;
      return this.changed();
    }
    this.removing = false;
    this.editing = null;
    for (const [key, { timer }] of [...this.saves])
      if (key.startsWith(`${id}:`)) {
        clearTimeout(timer);
        this.saves.delete(key);
      }
    await this.request({ _tag: 'Remove', id });
    await this.refresh();
  }

  async addFiles(files: ReadonlyArray<string>) {
    const id = this.editing;
    if (id === null || files.length === 0) return;
    // Their text goes after what's written.
    await this.flush();
    this.note = await this.request({ _tag: 'AddFiles', id, files });
    await this.refresh();
  }

  async choose() {
    await this.addFiles(await this.request({ _tag: 'Choose' }));
  }
}
