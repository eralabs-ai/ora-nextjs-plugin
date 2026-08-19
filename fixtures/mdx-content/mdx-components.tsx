import type { MDXComponents } from 'mdx/types';

// Required by @next/mdx in the App Router: the hook every MDX page resolves its components from.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return components;
}
