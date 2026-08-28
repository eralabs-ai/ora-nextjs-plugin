// The wizard's prompt layer, injected behind an interface over node:readline the same way cli.ts
// injects its `confirm` callback. Two reasons it's an interface, not direct readline calls: the
// whole `ax init` flow has to be unit-testable with scripted answers and no TTY, and the readline
// import must stay lazy so it never loads on a headless (`--yes`) run or in CI.

/** One option in a {@link Prompter.multiSelect} list. */
export interface MultiSelectChoice {
  /** Stable value returned when the choice is selected (e.g. a URL pathname). */
  value: string;
  /** What the user sees. */
  label: string;
  /** Whether it starts selected — the recommended default for this choice. */
  selected: boolean;
}

/**
 * One row of a multi-select: a selectable choice, or a display-only line rendered in place between
 * choices. Display rows exist so a selection can live *inside* a larger layout — the gating
 * question renders the whole route tree, with the checkbox sitting on the MCP server node and the
 * surrounding routes/tools as context — instead of the tree and a separate options list.
 */
export type MultiSelectRow = MultiSelectChoice | { text: string };

/** Narrows a {@link MultiSelectRow} to a selectable choice. */
export function isMultiSelectChoice(row: MultiSelectRow): row is MultiSelectChoice {
  return 'value' in row;
}

/**
 * Everything the wizard needs to ask a human. Kept deliberately small (free-text, yes/no,
 * multi-select) — anything richer would be harder to script in tests than it's worth. Every method
 * carries the default the wizard would apply, so a user pressing Enter accepts the recommendation.
 */
export interface Prompter {
  /** Free-text answer; empty input accepts `defaultValue`. */
  text(question: string, defaultValue?: string): Promise<string>;
  /** Yes/no; empty input accepts `defaultValue`. */
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  /** Returns the `value`s of the chosen choices; empty input keeps whatever was pre-selected. */
  multiSelect(question: string, rows: MultiSelectRow[]): Promise<string[]>;
  /**
   * Picks exactly one choice; empty input accepts the row whose `selected` is true (the default).
   * Same row model as {@link multiSelect}, so the choice can render inside the route-tree layout.
   */
  select(question: string, rows: MultiSelectRow[]): Promise<string | undefined>;
}

/**
 * The real interactive prompter: one shared readline interface over the process's stdin/stdout,
 * loaded lazily so nothing touches readline unless an interactive run actually reaches a question.
 * Callers must `close()` when the flow ends, so the process can exit.
 */
export async function createReadlinePrompter(): Promise<Prompter & { close(): void }> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return {
    async text(question, defaultValue) {
      // Prefill the default as *editable* input (rl.write injects it into the line buffer) rather
      // than showing it in parentheses: the user sees the value already typed and can press Enter to
      // accept or edit it in place — clearer than a "(default)" hint they have to retype to change.
      const answer = rl.question(`${question}\n> `);
      if (defaultValue) rl.write(defaultValue);
      return (await answer).trim();
    },

    async confirm(question, defaultValue) {
      const hint = defaultValue ? '[Y/n]' : '[y/N]';
      const answer = (await rl.question(`${question} ${hint} `)).trim().toLowerCase();
      if (answer === '') return defaultValue;
      return answer === 'y' || answer === 'yes';
    },

    async multiSelect(question, rows) {
      const choices = rows.filter(isMultiSelectChoice);
      if (choices.length === 0) return [];
      const selected = choices.map((choice) => choice.selected);

      // A genuinely selectable list: raw-mode keypresses move a cursor between the choice rows
      // (display rows are skipped — they're layout, like the rest of the route tree), space
      // toggles, Enter accepts. Still dependency-free: readline keypress events + ANSI redraws.
      if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
        return interactiveMultiSelect(rl, question, rows, choices, selected);
      }

      // No raw-mode TTY (dumb terminal): fall back to a numbered toggle list, which needs nothing
      // beyond plain line input.
      let n = 0;
      const rendered = rows
        .map((row) => {
          if (!isMultiSelectChoice(row)) return `         ${row.text}`.trimEnd();
          const index = n++;
          return ` ${String(index + 1).padStart(2)}. [${selected[index] ? 'x' : ' '}] ${row.label}`;
        })
        .join('\n');
      const answer = (
        await rl.question(
          `${question}\n${rendered}\n` +
            'Enter numbers to toggle (space/comma separated), or press Enter to accept: ',
        )
      ).trim();
      for (const token of answer.split(/[\s,]+/).filter((t) => t !== '')) {
        const index = Number.parseInt(token, 10) - 1;
        if (index >= 0 && index < choices.length) selected[index] = !selected[index];
      }
      return choices.filter((_, i) => selected[i]).map((choice) => choice.value);
    },

    async select(question, rows) {
      const choices = rows.filter(isMultiSelectChoice);
      if (choices.length === 0) return undefined;
      const defaultIndex = Math.max(
        choices.findIndex((choice) => choice.selected),
        0,
      );

      // Raw-mode single-select: the cursor *is* the selection — ↑/↓ move it, Enter picks the
      // focused row. Reuses the multi-select machinery with radio semantics (moving re-selects),
      // so the row layout (tree connectors, display rows) renders identically.
      if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
        const picked = await interactiveSelect(rl, question, rows, choices, defaultIndex);
        return picked;
      }

      // No raw-mode TTY (dumb terminal): a numbered list on plain line input.
      let n = 0;
      const rendered = rows
        .map((row) => {
          if (!isMultiSelectChoice(row)) return `         ${row.text}`.trimEnd();
          const index = n++;
          return ` ${String(index + 1).padStart(2)}. ${index === defaultIndex ? '(default) ' : ''}${row.label}`;
        })
        .join('\n');
      const answer = (
        await rl.question(
          `${question}\n${rendered}\nEnter a number to choose, or press Enter to accept the default: `,
        )
      ).trim();
      const index = Number.parseInt(answer, 10) - 1;
      const chosen =
        answer !== '' && index >= 0 && index < choices.length
          ? choices[index]
          : choices[defaultIndex];
      return chosen?.value;
    },

    close() {
      rl.close();
    },
  };
}

/**
 * The terminal width to wrap the redraw region against, re-read on every draw (not cached) so a
 * resize mid-prompt is honored on the very next keystroke instead of corrupting the layout.
 * `output.columns` is `undefined` on a stream that isn't actually a TTY column-aware pipe — and
 * `0` on a PTY that never had its size initialized (observed under `script(1)`), which would
 * truncate every row to the empty string; both fall back to the conservative 80.
 */
function terminalColumns(output: NodeJS.WriteStream): number {
  const columns = output.columns;
  return columns !== undefined && columns > 0 ? columns : 80;
}

/**
 * Detaches the shared readline interface's key handling for the duration of a raw-mode selector,
 * returning the restore function. `rl.pause()` alone is NOT enough: pausing stops the input
 * stream, but the selector immediately resumes it to read its own raw bytes — and readline's
 * `keypress` listener is still attached, so it processes the same keys in parallel. An arrow-up
 * then recalls the *previous question's answer* from history and rewrites it over the redraw
 * region, and every printable key (space, j/k) is echoed at the cursor — the garbled rows this
 * guards against. Node's `emitKeypressEvents` machinery re-attaches its internal data decoder via
 * a `newListener` hook when the listeners come back, so remove-and-restore is safe.
 */
function suspendKeypressListeners(input: NodeJS.ReadStream): () => void {
  const listeners = input.rawListeners('keypress') as Array<(...args: unknown[]) => void>;
  input.removeAllListeners('keypress');
  return () => {
    for (const listener of listeners) input.on('keypress', listener);
  };
}

/**
 * Truncates a rendered row to fit one physical terminal row. These rows carry no ANSI escapes, so
 * `.length` is exactly the visible width the terminal will lay out — a row at or past `columns`
 * wraps onto a second physical row that the redraw below doesn't know about. Truncating here is the
 * first of two defenses (paired with the physical-row accounting in `draw`): it keeps every logical
 * row to exactly one physical row, so the cursor-up arithmetic never has to reconstruct a wrap.
 */
function truncateToWidth(line: string, columns: number): string {
  return line.length > columns - 1 ? line.slice(0, Math.max(0, columns - 1)) : line;
}

/**
 * How many physical terminal rows a (already-visible-width) line occupies. Kept as a second,
 * independent defense alongside {@link truncateToWidth}: even if a line ever slipped through
 * untruncated (a stale `columns` read, an edge-case width), the cursor-up math below still moves by
 * the true number of physical rows instead of assuming one row per line.
 */
function physicalRowCount(line: string, columns: number): number {
  return Math.max(1, Math.ceil(line.length / columns));
}

/**
 * The raw-mode selector behind {@link Prompter.multiSelect}: a cursor (`❯`) sits on a choice row,
 * ↑/↓ (or j/k, tab) move it between the choice rows only — display rows are inert layout — space
 * toggles, Enter accepts. The question is printed once above the redraw region (a long question
 * may wrap, which would break the cursor-up arithmetic); only the rows + key hint are redrawn.
 * Ctrl-C exits the process like any aborted prompt.
 *
 * Keys are parsed off a raw `data` listener rather than readline keypress events: the shared
 * readline interface is paused for the duration (so it can't consume the bytes into its line
 * buffer), and an explicitly-paused stream emits nothing and holds no event-loop ref — the
 * `input.resume()` here is what keeps the process alive and the keys flowing. Raw mode and the
 * interface are always restored on the way out, so the following `rl.question` works untouched.
 */
function interactiveMultiSelect(
  rl: { pause(): void; resume(): void },
  question: string,
  rows: MultiSelectRow[],
  choices: MultiSelectChoice[],
  selected: boolean[],
): Promise<string[]> {
  const input = process.stdin;
  const output = process.stdout;

  let focus = 0;
  const renderRegion = (): string[] => {
    let n = -1;
    const body = rows.map((row) => {
      // Display rows get exactly the choice prefix's width (` > [x] ` = 7 chars) so tree
      // connectors line up across selectable and inert rows. ASCII-only markers on purpose:
      // ambiguous-width glyphs (❯ • ·) render two columns wide under some terminal/font configs,
      // wrapping a line the redraw arithmetic counted as one physical row.
      if (!isMultiSelectChoice(row)) return `       ${row.text}`.trimEnd();
      n++;
      return `${n === focus ? ' >' : '  '} [${selected[n] ? 'x' : ' '}] ${row.label}`;
    });
    return [...body, '', 'up/down move - space toggle - enter accept'];
  };

  output.write(`${question}\n`);
  // `regionHeight` is tracked in *physical* terminal rows, not logical lines: a line as long as (or
  // longer than) the terminal width wraps onto a second physical row that the naive "one row per
  // line" count misses, so the next draw's cursor-up would land above the true region top — inside
  // whatever was printed before the prompt — and `\x1b[2K` + the rewrites would clobber it, with
  // stray physical rows left behind to corrupt whatever prints after. Truncating every line to the
  // terminal width (so it can never wrap) and re-deriving `columns` on every draw (so a resize
  // mid-prompt can't desync the two) are both applied so the arithmetic stays exact.
  let regionHeight = 0;
  const draw = (): void => {
    const columns = terminalColumns(output);
    const lines = renderRegion().map((line) => truncateToWidth(line, columns));
    if (regionHeight > 0) output.write(`\x1b[${regionHeight}A`);
    for (const line of lines) output.write(`\x1b[2K${line}\n`);
    regionHeight = lines.reduce((sum, line) => sum + physicalRowCount(line, columns), 0);
  };

  rl.pause();
  const restoreKeypress = suspendKeypressListeners(input);
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?25l');
  draw();

  return new Promise((resolve) => {
    const finish = (): void => {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      output.write('\x1b[?25h');
      restoreKeypress();
      rl.resume();
      resolve(choices.filter((_, i) => selected[i]).map((choice) => choice.value));
    };
    const onData = (chunk: Buffer): void => {
      const keys = chunk.toString('utf8');
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === '\x03') {
          // Ctrl-C: restore the terminal, then exit like any aborted prompt.
          input.setRawMode(wasRaw);
          output.write('\x1b[?25h\n');
          process.exit(130);
        }
        if (keys.startsWith('\x1b[A', i) || keys[i] === 'k') {
          focus = (focus - 1 + choices.length) % choices.length;
          draw();
        } else if (keys.startsWith('\x1b[B', i) || keys[i] === 'j' || keys[i] === '\t') {
          focus = (focus + 1) % choices.length;
          draw();
        } else if (keys[i] === ' ') {
          selected[focus] = !(selected[focus] ?? false);
          draw();
        } else if (keys[i] === '\r' || keys[i] === '\n') {
          finish();
          return;
        }
        if (keys[i] === '\x1b') i += 2; // skip the rest of a parsed escape sequence
      }
    };
    input.on('data', onData);
  });
}

/**
 * The raw-mode selector behind {@link Prompter.select}: single-choice radio semantics on the same
 * row layout as {@link interactiveMultiSelect} — ↑/↓ (or j/k, tab) move the cursor between the
 * choice rows, and the focused row *is* the selection (`(•)`), so Enter simply accepts it. Same
 * terminal handling as the multi-select: the shared readline interface is paused, raw mode and the
 * cursor are restored on the way out, Ctrl-C exits the process.
 */
function interactiveSelect(
  rl: { pause(): void; resume(): void },
  question: string,
  rows: MultiSelectRow[],
  choices: MultiSelectChoice[],
  defaultIndex: number,
): Promise<string | undefined> {
  const input = process.stdin;
  const output = process.stdout;

  let focus = defaultIndex;
  const renderRegion = (): string[] => {
    let n = -1;
    const body = rows.map((row) => {
      // Display rows get exactly the choice prefix's width (` > (*) ` = 7 chars) so tree
      // connectors line up across selectable and inert rows. ASCII-only markers — same
      // ambiguous-width reasoning as the multi-select renderer above.
      if (!isMultiSelectChoice(row)) return `       ${row.text}`.trimEnd();
      n++;
      return `${n === focus ? ' >' : '  '} (${n === focus ? '*' : ' '}) ${row.label}`;
    });
    return [...body, '', 'up/down move - enter accept'];
  };

  output.write(`${question}\n`);
  // `regionHeight` is tracked in *physical* terminal rows, not logical lines — see the identical
  // reasoning in `interactiveMultiSelect`'s `draw`: a line as long as (or longer than) the terminal
  // width would otherwise wrap onto a second physical row the cursor-up math doesn't know about,
  // corrupting whatever was printed before (and after) the prompt. Truncating every line to the
  // terminal width plus re-deriving `columns` on every draw are both applied so a resize mid-prompt
  // can't desync the arithmetic either.
  let regionHeight = 0;
  const draw = (): void => {
    const columns = terminalColumns(output);
    const lines = renderRegion().map((line) => truncateToWidth(line, columns));
    if (regionHeight > 0) output.write(`\x1b[${regionHeight}A`);
    for (const line of lines) output.write(`\x1b[2K${line}\n`);
    regionHeight = lines.reduce((sum, line) => sum + physicalRowCount(line, columns), 0);
  };

  rl.pause();
  const restoreKeypress = suspendKeypressListeners(input);
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?25l');
  draw();

  return new Promise((resolve) => {
    const finish = (): void => {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      output.write('\x1b[?25h');
      restoreKeypress();
      rl.resume();
      resolve(choices[focus]?.value);
    };
    const onData = (chunk: Buffer): void => {
      const keys = chunk.toString('utf8');
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === '\x03') {
          input.setRawMode(wasRaw);
          output.write('\x1b[?25h\n');
          process.exit(130);
        }
        if (keys.startsWith('\x1b[A', i) || keys[i] === 'k') {
          focus = (focus - 1 + choices.length) % choices.length;
          draw();
        } else if (keys.startsWith('\x1b[B', i) || keys[i] === 'j' || keys[i] === '\t') {
          focus = (focus + 1) % choices.length;
          draw();
        } else if (keys[i] === '\r' || keys[i] === '\n') {
          finish();
          return;
        }
        if (keys[i] === '\x1b') i += 2; // skip the rest of a parsed escape sequence
      }
    };
    input.on('data', onData);
  });
}
