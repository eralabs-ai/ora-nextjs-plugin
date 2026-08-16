// The single source of truth for who counts as an AI agent or bot, so crawler names never drift
// between the features that reference them: the `robots.txt` scaffold's Allow policy, the
// request-detection cascade in the runtime middleware, and any future docs/recommendation copy.
//
// The corpus is four data sets maintained together, because they are read together (a UA is matched
// against layer 1, then excluded via layer 3, then heuristically caught via layer 4) and go stale
// together. Sources are public and primary: the crowd-maintained UA directory at bots.fyi and each
// vendor's own published bot documentation (linked per group below). A single review date makes
// staleness visible at a glance — re-cross-check against those sources and bump it.

/** When the four data sets below were last cross-checked against bots.fyi + vendor bot docs. */
export const UA_CORPUS_REVIEWED = '2026-03-20';

/**
 * Layer 1 — lowercase substrings that identify an AI agent's user-agent, grouped by vendor. Matched
 * with a case-insensitive `includes`, so each entry is the distinctive fragment of the real UA
 * (e.g. `gptbot` matches `Mozilla/5.0 … GPTBot/1.2`). Grouped, not flat, so a vendor's family can be
 * reviewed as a unit against that vendor's docs.
 */
export const AI_AGENT_UA_PATTERNS: readonly string[] = [
  // Anthropic — https://docs.anthropic.com/en/docs/claude-code/bot-activity (Claude's crawlers)
  'claudebot',
  'claude-searchbot',
  'claude-user',
  'claude-web',
  'anthropic-ai',

  // OpenAI — https://platform.openai.com/docs/bots
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'chatgpt',
  'openai',

  // Google AI — https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
  'google-extended',
  'googleother',
  'google-cloudvertexbot',
  'gemini',
  'bard',

  // Meta AI — https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/
  'meta-externalagent',
  'meta-externalfetcher',
  'facebookbot',

  // Search / research AI answer engines
  'perplexitybot',
  'perplexity-user',
  'youbot',
  'you.com',
  'deepseekbot',
  'cohere-ai',

  // Coding assistants (agent-embedded fetchers)
  'github-copilot',
  'codeium',
  'cursor',

  // General-purpose crawlers used to feed AI systems
  'amazonbot',
  'ai2bot',
  'diffbot',
  'bytespider',
  'omgili',
  'omgilibot',
];

/**
 * Layer 2 — domains that appear in the `Signature-Agent` request header (RFC 9421), an emerging
 * cryptographically-signed self-identification. Matched case-insensitively as a substring of the
 * header value. Currently only ChatGPT's agent sends it.
 */
export const SIGNATURE_AGENT_DOMAINS: readonly string[] = ['chatgpt.com'];

/**
 * Layer 3 — traditional bots that must keep receiving user-facing HTML: search-engine crawlers that
 * index the human page, social-preview unfurlers, and uptime/monitoring probes. This is the
 * "cloaking firewall" — serving markdown to these would make the site look cloaked to the search
 * engines and break link previews. They are matched against the same UA and, when matched, suppress
 * the layer-4 heuristic so they are never treated as AI agents.
 */
export const TRADITIONAL_BOT_PATTERNS: readonly string[] = [
  'googlebot',
  'bingbot',
  'yandexbot',
  'baiduspider',
  'duckduckbot',
  'slurp',
  'msnbot',
  'applebot',
  'facebot',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'discordbot',
  'pingdom',
  'uptimerobot',
  'newrelic',
  'datadog',
  'statuspage',
];

/**
 * Layer 4 — a broad bot-like UA regex used *only* by the detection heuristic (a request with no
 * `sec-fetch-mode` and a UA that looks automated, once layer-3 traditional bots are excluded). No
 * word boundaries: these keywords appear inside compound product names ("…SearchBot", "…Crawler").
 */
export const BOT_LIKE_REGEX = /bot|agent|fetch|crawl|spider|search/i;

/**
 * The `robots.txt` allow policy, derived from the corpus above but expressed as canonical
 * `User-agent` tokens (correct casing, as each vendor documents them) rather than lowercase match
 * substrings — the two forms differ and both are needed.
 *
 * Reputable retrieval and search crawlers named individually: a blanket `User-agent: *` says nothing
 * about whether agent traffic is welcome, so agent-readiness scanners look for explicit per-agent
 * rules. These are the crawlers whose tokens are stable, publicly documented, and fetch content to
 * answer a user's live question (retrieval/search) rather than to train a model — allowing them is
 * uncontroversial. Grouped by vendor to match the layer-1 groups.
 */
export const REPUTABLE_AI_CRAWLERS: readonly string[] = [
  // OpenAI
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  // Anthropic
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  // Google
  'Google-Extended',
  // Perplexity
  'PerplexityBot',
  'Perplexity-User',
  // Meta
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
  // Amazon
  'Amazonbot',
  // Allen Institute for AI
  'AI2Bot',
  // Diffbot
  'Diffbot',
];

/**
 * Crawlers the scaffold shows how to restrict, always commented out. These collect content to train
 * models rather than to answer a user's live question, so whether to block them is a decision about
 * the site's content and business — the owner's call, never ours.
 */
export const TRAINING_ONLY_CRAWLERS: readonly string[] = ['CCBot', 'Bytespider'];
