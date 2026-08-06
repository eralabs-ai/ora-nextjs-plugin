import type { AppProps } from 'next/app';

// A special file, never a route. The plugin must not list `/_app`.
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
