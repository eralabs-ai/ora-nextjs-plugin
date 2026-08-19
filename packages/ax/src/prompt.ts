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

    close() {
      rl.close();
    },
  };
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
      // Display rows get exactly the choice prefix's width (` ❯ [x] ` = 7 chars) so tree
      // connectors line up across selectable and inert rows.
      if (!isMultiSelectChoice(row)) return `       ${row.text}`.trimEnd();
      n++;
      return `${n === focus ? ' ❯' : '  '} [${selected[n] ? 'x' : ' '}] ${row.label}`;
    });
    return [...body, '', '↑/↓ move · space toggle · enter accept'];
  };

  output.write(`${question}\n`);
  let regionHeight = 0;
  const draw = (): void => {
    const lines = renderRegion();
    if (regionHeight > 0) output.write(`\x1b[${regionHeight}A`);
    for (const line of lines) output.write(`\x1b[2K${line}\n`);
    regionHeight = lines.length;
  };

  rl.pause();
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
