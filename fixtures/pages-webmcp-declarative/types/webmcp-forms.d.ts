import 'react';

// The WebMCP declarative form attributes (`toolname`, `tooldescription`) aren't in React's built-in
// types. This augmentation just lets them type-check as custom string attributes — it does not
// define or invent the convention, it only describes what the draft markup already uses.
declare module 'react' {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
  }
}
