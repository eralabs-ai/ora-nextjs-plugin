import { Html, Head, Main, NextScript } from 'next/document';

// A special file, never a route. The plugin must not list `/_document`.
export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
