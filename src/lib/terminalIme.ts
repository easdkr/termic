import type { Terminal } from "@xterm/xterm";

export function isImeKeyboardEvent(e: KeyboardEvent): boolean {
  const maybeLegacy = e as KeyboardEvent & { keyCode?: number; which?: number };
  return e.isComposing
    || e.key === "Process"
    || maybeLegacy.keyCode === 229
    || maybeLegacy.which === 229;
}

export function committedImeText(startValue: string, currentValue: string, fallback: string): string {
  if (currentValue.startsWith(startValue)) {
    const diff = currentValue.slice(startValue.length);
    if (diff) return diff;
  }
  return fallback;
}

interface TerminalInputProxy {
  dispose: () => void;
  focus: () => void;
  isComposing: () => boolean;
}

function ctrlKeyData(e: KeyboardEvent): string | null {
  if (!e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === " ") return "\x00";
  if (e.key === "[") return "\x1b";
  if (e.key === "\\") return "\x1c";
  if (e.key === "]") return "\x1d";
  if (e.key === "^") return "\x1e";
  if (e.key === "_") return "\x1f";
  if (/^[a-zA-Z]$/.test(e.key)) {
    return String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
  }
  return null;
}

export function terminalKeyData(e: KeyboardEvent, term: Pick<Terminal, "modes">): string | null {
  if (e.metaKey) {
    if (e.key === "Backspace") return "\x15"; // Cmd+Backspace: kill line
    if (e.key === "ArrowLeft") return "\x01"; // Cmd+Left: beginning of line
    if (e.key === "ArrowRight") return "\x05"; // Cmd+Right: end of line
    return null;
  }
  if (e.altKey && !e.ctrlKey) {
    if (e.key === "Backspace") return "\x17"; // Option+Backspace: kill word
    if (e.key === "ArrowLeft") return "\x1bb";
    if (e.key === "ArrowRight") return "\x1bf";
    return null;
  }
  if (e.key === "Enter") return e.shiftKey ? "\\\r" : "\r";
  if (e.key === "Backspace") return "\x7f";
  if (e.key === "Tab") return "\t";
  if (e.key === "Escape") return "\x1b";
  if (e.key === "Delete") return "\x1b[3~";
  if (e.key === "Home") return "\x1b[H";
  if (e.key === "End") return "\x1b[F";
  if (e.key === "PageUp") return "\x1b[5~";
  if (e.key === "PageDown") return "\x1b[6~";

  const appCursor = term.modes.applicationCursorKeysMode;
  if (e.key === "ArrowUp") return appCursor ? "\x1bOA" : "\x1b[A";
  if (e.key === "ArrowDown") return appCursor ? "\x1bOB" : "\x1b[B";
  if (e.key === "ArrowRight") return appCursor ? "\x1bOC" : "\x1b[C";
  if (e.key === "ArrowLeft") return appCursor ? "\x1bOD" : "\x1b[D";

  return ctrlKeyData(e);
}

export interface TerminalInputProxyOpts {
  /** Called when an image is pasted from the clipboard.
   *  The handler should save the file and write its path into the PTY.
   *  When omitted, image paste is silently ignored (legacy behaviour). */
  onImagePaste?: (file: File) => void;
}

export function installTerminalInputProxy(
  host: HTMLElement,
  term: Terminal,
  sendData: (data: string) => void,
  opts?: TerminalInputProxyOpts,
): TerminalInputProxy {
  const xtermTextarea = term.textarea;
  const xtermEl = host.querySelector(".xterm") as HTMLElement | null;

  const input = document.createElement("textarea");
  input.className = "termic-terminal-input";
  input.setAttribute("aria-label", "Terminal input");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
  input.tabIndex = 0;
  host.appendChild(input);

  const overlay = document.createElement("div");
  overlay.className = "termic-ime-overlay";
  overlay.setAttribute("aria-hidden", "true");
  host.appendChild(overlay);

  let composing = false;
  let startValue = "";
  let latestData = "";
  let renderDisposable: { dispose: () => void } | undefined;

  const syncPosition = () => {
    const parentRect = host.getBoundingClientRect();
    const sourceRect = xtermTextarea?.getBoundingClientRect();
    const left = sourceRect ? sourceRect.left - parentRect.left : 8;
    const top = sourceRect ? sourceRect.top - parentRect.top : 8;
    const height = sourceRect ? Math.max(sourceRect.height, 1) : Math.max(term.options.fontSize ?? 14, 14);
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.height = `${height}px`;
    input.style.lineHeight = `${height}px`;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.minHeight = `${height}px`;
    overlay.style.lineHeight = `${height}px`;
    overlay.style.fontFamily = term.options.fontFamily ?? "monospace";
    overlay.style.fontSize = `${term.options.fontSize ?? 14}px`;
  };

  const focus = () => {
    syncPosition();
    input.focus({ preventScroll: true });
  };

  const clearInput = () => {
    input.value = "";
    startValue = "";
  };

  const clearOverlay = () => {
    overlay.textContent = "";
    overlay.classList.remove("active");
    xtermEl?.classList.remove("termic-ime-active");
  };

  const sendText = (text: string) => {
    if (!text) return;
    sendData(text);
    clearInput();
  };

  const onPointerDown = (ev: PointerEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest("button, input:not(.termic-terminal-input), textarea:not(.termic-terminal-input), [data-no-drag]")) return;
    requestAnimationFrame(focus);
  };

  if (xtermTextarea) xtermTextarea.tabIndex = -1;

  const onXtermFocus = () => focus();

  const onBeforeInput = (ev: InputEvent) => {
    if (composing || ev.inputType !== "insertText" || !ev.data) return;
    ev.preventDefault();
    ev.stopPropagation();
    sendText(ev.data);
  };

  const onInput = () => {
    if (composing) return;
    const value = input.value;
    if (value) sendText(value);
  };

  const onPaste = (ev: ClipboardEvent) => {
    const items = ev.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          ev.preventDefault();
          ev.stopPropagation();
          const file = item.getAsFile();
          if (file) {
            opts?.onImagePaste?.(file);
          }
          return;
        }
      }
    }
    const text = ev.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    ev.preventDefault();
    ev.stopPropagation();
    sendText(text.replace(/\r?\n/g, "\r"));
  };

  const onCompositionStart = () => {
    composing = true;
    startValue = input.value;
    latestData = "";
    overlay.textContent = "";
    overlay.classList.add("active");
    xtermEl?.classList.add("termic-ime-active");
    syncPosition();
  };

  const onCompositionUpdate = (ev: CompositionEvent) => {
    latestData = ev.data;
    overlay.textContent = ev.data;
    overlay.classList.add("active");
    syncPosition();
  };

  const onCompositionEnd = (ev: CompositionEvent) => {
    latestData = ev.data || latestData;
    window.setTimeout(() => {
      const text = committedImeText(startValue, input.value, latestData);
      composing = false;
      latestData = "";
      clearOverlay();
      sendText(text);
    }, 0);
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (isImeKeyboardEvent(ev) || composing) return;
    const data = terminalKeyData(ev, term);
    if (!data) return;
    ev.preventDefault();
    ev.stopPropagation();
    sendText(data);
  };

  const onBlur = () => {
    composing = false;
    latestData = "";
    clearInput();
    clearOverlay();
  };

  host.addEventListener("pointerdown", onPointerDown, true);
  xtermTextarea?.addEventListener("focus", onXtermFocus);
  input.addEventListener("beforeinput", onBeforeInput);
  input.addEventListener("input", onInput);
  input.addEventListener("paste", onPaste);
  input.addEventListener("compositionstart", onCompositionStart);
  input.addEventListener("compositionupdate", onCompositionUpdate);
  input.addEventListener("compositionend", onCompositionEnd);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("blur", onBlur);
  renderDisposable = term.onRender(syncPosition);
  syncPosition();

  return {
    focus,
    isComposing: () => composing,
    dispose: () => {
      renderDisposable?.dispose();
      host.removeEventListener("pointerdown", onPointerDown, true);
      xtermTextarea?.removeEventListener("focus", onXtermFocus);
      input.removeEventListener("beforeinput", onBeforeInput);
      input.removeEventListener("input", onInput);
      input.removeEventListener("paste", onPaste);
      input.removeEventListener("compositionstart", onCompositionStart);
      input.removeEventListener("compositionupdate", onCompositionUpdate);
      input.removeEventListener("compositionend", onCompositionEnd);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("blur", onBlur);
      clearOverlay();
      input.remove();
      overlay.remove();
    },
  };
}
