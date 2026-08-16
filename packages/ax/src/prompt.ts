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
 * Everything the wizard needs to ask a human. Kept deliberately small (free-text, yes/no,
 * multi-select) — anything richer would be harder to script in tests than it's worth. Every method
 * carries the default the wizard would apply, so a user pressing Enter accepts the recommendation.
 */
export interface Prompter {
  /** Free-text answer; empty input accepts `defaultValue`. */
  text(question: string, defaultValue?: string): Promise<string>;
  /** Yes/no; empty input accepts `defaultValue`. */
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  /** Returns the `value`s of the chosen options; empty input keeps whatever was pre-selected. */
  multiSelect(question: string, choices: MultiSelectChoice[]): Promise<string[]>;
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
      const suffix = defaultValue ? ` (${defaultValue})` : '';
      const answer = (await rl.question(`${question}${suffix}\n> `)).trim();
      return answer === '' && defaultValue !== undefined ? defaultValue : answer;
    },

    async confirm(question, defaultValue) {
      const hint = defaultValue ? '[Y/n]' : '[y/N]';
      const answer = (await rl.question(`${question} ${hint} `)).trim().toLowerCase();
      if (answer === '') return defaultValue;
      return answer === 'y' || answer === 'yes';
    },

    async multiSelect(question, choices) {
      // A numbered list with pre-selected items marked; the user types the numbers to *toggle*.
      // Numbers rather than a curses-style checkbox UI so this stays dependency-free and its output
      // is legible in a plain build log.
      const selected = choices.map((choice) => choice.selected);
      const render = (): string =>
        choices
          .map((choice, i) => `  ${i + 1}. [${selected[i] ? 'x' : ' '}] ${choice.label}`)
          .join('\n');
      const answer = (
        await rl.question(
          `${question}\n${render()}\n` +
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
