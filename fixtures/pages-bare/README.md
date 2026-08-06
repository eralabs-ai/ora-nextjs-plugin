# pages-bare

A minimal **Pages Router** app (no `app/` directory). Its job in the corpus is to prove the plugin
handles Pages Router route topology: `pages/index.tsx` and `pages/about.tsx` are addressable routes,
while `pages/_app.tsx`, `pages/_document.tsx`, `pages/404.tsx`, and `pages/blog/[slug].tsx` (dynamic)
are correctly excluded from the route list.
