# fixture: webmcp-declarative

Declares an in-page WebMCP tool with JSX `<form toolname="..." tooldescription="...">`.

**Exercises:** the Phase 4 declarative detector — the near-trivial, high-confidence case. The tool is
read straight off the JSX attributes. `types/webmcp-forms.d.ts` augments React's `FormHTMLAttributes`
so the custom attributes type-check.
