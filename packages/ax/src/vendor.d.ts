// Hand-written declarations for the two untyped converter dependencies. This package compiles with
// lib: ES2022 (no DOM), so the domino declaration carries its own minimal element surface instead
// of referencing DOM lib types.

declare module '@mixmark-io/domino' {
  export interface DominoElement {
    textContent: string | null;
    innerHTML: string;
    outerHTML: string;
    /** domino returns undefined (not the DOM-spec null) on a query miss. */
    querySelector(selector: string): DominoElement | null | undefined;
    querySelectorAll(selector: string): ArrayLike<DominoElement>;
    getAttribute(name: string): string | null;
    remove(): void;
  }

  export interface DominoDocument {
    title: string;
    body: DominoElement | null;
    /** domino returns undefined (not the DOM-spec null) on a query miss. */
    querySelector(selector: string): DominoElement | null | undefined;
    querySelectorAll(selector: string): ArrayLike<DominoElement>;
  }

  export function createDocument(html?: string, force?: boolean): DominoDocument;
}

declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export function gfm(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
  export function taskListItems(service: TurndownService): void;
}
