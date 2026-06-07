// Normalize the stable gh error-code prefixes (set by `classify_gh_error`
// in src-tauri/src/lib.rs) into user-friendly toast text. The Rust side
// returns errors as `"<code>: <message>"` so the UI matches on the
// leading `code` token and maps it to a sentence the user can act on.
//
// The codes:
//   - `gh_unavailable:`     → `gh` binary missing on PATH
//   - `gh_unauthenticated:` → `gh auth status` shows the user is signed out
//   - `rate_limited:`       → GitHub API rate limit hit
//   - `gh_error:`           → any other gh failure (the Rust side appends
//                             the verbatim stderr; we keep that text so
//                             the user sees the actual reason).
//
// Severity is "info" for the actionable-but-not-the-user's-fault cases
// (install / auth / rate limit) and "error" for the catch-all.

export type GhToastSeverity = "info" | "error";

export interface GhToastMessage {
  message: string;
  severity: GhToastSeverity;
}

/** Pull the leading error code from a Rust-formatted gh error string.
 *  Returns the original string when no `:` separator is present (the
 *  IPC may pass through non-prefixed errors from callers that don't
 *  route through `classify_gh_error`). */
function codeOf(error: string): string {
  return error.split(":", 1)[0]?.trim() ?? "";
}

export function ghErrorToToastText(error: string): GhToastMessage {
  const code = codeOf(error);
  switch (code) {
    case "gh_unavailable":
      return {
        message: "Install and authenticate the `gh` CLI to use GitHub features. Run `brew install gh && gh auth login`.",
        severity: "info",
      };
    case "gh_unauthenticated":
      return {
        message: "Run `gh auth login` to connect to GitHub.",
        severity: "info",
      };
    case "rate_limited":
      return {
        message: "GitHub API rate limit hit. Try again in a few minutes.",
        severity: "info",
      };
    case "gh_error":
      // Keep the gh error text verbatim (the Rust side already includes
      // the relevant context). Strip the leading "gh_error:" prefix so
      // the toast reads as a sentence rather than a status code.
      return {
        message: error.replace(/^gh_error:\s*/, "").trim() || error,
        severity: "error",
      };
    default:
      // Unknown code (or no code at all) — pass the error through so
      // the user still sees something. Matches the pre-helper behavior
      // in RightPanel's merge bar and the DiffCommentPopover's post
      // error path.
      return { message: error, severity: "error" };
  }
}
