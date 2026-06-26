// Convert GitHub-flavored / standard markdown (as emitted by the LLM) into
// Slack "mrkdwn" so FundBot answers render correctly in Slack instead of
// showing literal asterisks, raw [text](url) links, and `#` headers.
//
// Slack mrkdwn differs from standard markdown:
//   - bold:    **text** / __text__   ->  *text*
//   - italic:  *text* / _text_       ->  _text_
//   - link:    [text](url)           ->  <url|text>
//   - header:  # / ## / ### text     ->  *text*  (Slack has no headers)
//   - bullet:  - item / * item       ->  • item
//
// Inline code (`x`) and fenced code blocks (```...```) are left untouched so
// their contents (which may legitimately contain *, _, #, etc.) are preserved.
//
// We chose a focused hand-rolled converter over the `slackify-markdown` npm
// package: that package is ESM-only at its current major (the project is
// CommonJS / Vercel serverless) and even its CommonJS release injects
// zero-width spaces around bold and extra padding into bullets, which would
// corrupt FundBot's exact numbers (e.g. "*121,086,240 shares*"). This
// converter produces clean, predictable output.

/**
 * Convert markdown text to Slack mrkdwn.
 *
 * Order of operations matters: bold (`**`/`__`) is converted before italic
 * (`*`/`_`) so the single-character italic rules don't clobber bold markers.
 * Bold output and code spans/blocks are stashed behind tokens while the rest
 * of the text is rewritten, then restored at the end, so nothing inside them
 * is altered.
 */
export function toSlackMrkdwn(text: string): string {
  if (!text) return text;

  // 1. Protect fenced code blocks and inline code from any conversion.
  const codeStore: string[] = [];
  const stashCode = (match: string): string => {
    const token = ` CODE${codeStore.length} `;
    codeStore.push(match);
    return token;
  };

  let out = text
    // Fenced blocks first (```...```), including the language hint line.
    .replace(/```[\s\S]*?```/g, stashCode)
    // Then inline code spans (`...`).
    .replace(/`[^`\n]*`/g, stashCode);

  // 2. Bold: **text** or __text__ -> *text*. Stash the result behind a token
  //    so the single-char italic pass below can't re-rewrite the Slack bold
  //    markers (which are also single asterisks) into underscores.
  const boldStore: string[] = [];
  const stashBold = (_m: string, inner: string): string => {
    const token = ` BOLD${boldStore.length} `;
    boldStore.push(`*${inner}*`);
    return token;
  };
  out = out
    .replace(/\*\*([^\n]+?)\*\*/g, stashBold)
    .replace(/__([^\n]+?)__/g, stashBold);

  // 3. Italic: *text* -> _text_ (only standard-markdown single asterisks
  //    remain at this point — bold is stashed) and _text_ stays _text_.
  //    Require non-space immediately inside the markers so we don't match
  //    stray asterisks.
  out = out.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, '$1_$2_');

  // 4. Links: [text](url) -> <url|text>.
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>');

  // 5. Headers: leading #, ##, ### ... -> bold line.
  out = out.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, '*$1*');

  // 6. Bullets: leading "- " or "* " (with optional indentation) -> "• ".
  out = out.replace(/^([ \t]*)[-*][ \t]+/gm, '$1• ');

  // 7. Restore stashed bold (as Slack *bold*) and protected code spans/blocks.
  out = out.replace(/ BOLD(\d+) /g, (_m, i) => boldStore[Number(i)]);
  out = out.replace(/ CODE(\d+) /g, (_m, i) => codeStore[Number(i)]);

  return out;
}
