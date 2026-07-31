/**
 * tracking/changePopover.ts
 *
 * The hover affordance on a tracked change: what it is, who made it, and the
 * two buttons that resolve it.
 *
 * Built as plain DOM rather than React because `App.tsx` is frozen and renders
 * nothing for this lane — `useTrackedChanges` is called for its effects, not
 * its markup. A popover parented to `document.body` also avoids putting a
 * positioned element inside the editor, where it would sit inside the
 * contenteditable and disturb both the caret and the page geometry.
 */

import type { EditorView } from "@tiptap/pm/view";
import type { ChangeAuthor } from "../types";
import type { ChangeKind } from "./ranges";

export interface ChangeDescription {
  author: ChangeAuthor;
  kind: ChangeKind;
}

export interface PopoverActions {
  describe: (id: string) => ChangeDescription | null;
  accept: (id: string) => void;
  reject: (id: string) => void;
}

export interface ChangePopover {
  showFor: (id: string) => void;
  hide: () => void;
  destroy: () => void;
}

/** Long enough to cross the gap between the text and the popover. */
const HIDE_DELAY_MS = 140;

const AUTHOR_LABEL: Record<ChangeAuthor, string> = {
  human: "You",
  ai: "AI",
};

const KIND_LABEL: Record<ChangeKind, string> = {
  insertion: "inserted",
  deletion: "deleted",
};

export function createChangePopover(
  view: EditorView,
  actions: PopoverActions,
): ChangePopover {
  const root = document.createElement("div");
  root.className = "quill-tc-popover";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Tracked change");
  root.hidden = true;

  const label = document.createElement("span");
  label.className = "quill-tc-popover__label";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "quill-tc-popover__button quill-tc-popover__button--accept";
  accept.textContent = "Accept";

  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "quill-tc-popover__button quill-tc-popover__button--reject";
  reject.textContent = "Reject";

  root.append(label, accept, reject);
  document.body.appendChild(root);

  let currentId: string | null = null;
  let hideTimer: number | null = null;

  const cancelHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const hide = () => {
    cancelHide();
    currentId = null;
    root.hidden = true;
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimer = window.setTimeout(hide, HIDE_DELAY_MS);
  };

  const elementFor = (id: string): HTMLElement | null =>
    view.dom.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(id)}"]`);

  const showFor = (id: string) => {
    const description = actions.describe(id);
    const element = elementFor(id);
    if (!description || !element) {
      hide();
      return;
    }

    cancelHide();
    currentId = id;
    label.textContent = `${AUTHOR_LABEL[description.author]} ${KIND_LABEL[description.kind]}`;
    root.dataset.author = description.author;
    root.dataset.kind = description.kind;
    root.hidden = false;

    // A change that wraps across lines reports a box spanning both; anchor to
    // the first line's rectangle so the popover sits over the change's start.
    const rects = element.getClientRects();
    const rect = rects.length > 0 ? rects[0] : element.getBoundingClientRect();
    const { width, height } = root.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );
    const above = rect.top - height - 6;
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(above > 8 ? above : rect.bottom + 6)}px`;
  };

  const onOver = (event: Event) => {
    const target = event.target;
    if (!(target instanceof globalThis.Element)) return;
    const hit = target.closest<HTMLElement>("[data-change-id]");
    if (!hit) return;
    const id = hit.dataset.changeId;
    if (id) showFor(id);
  };

  const onOut = (event: Event) => {
    const related = (event as MouseEvent).relatedTarget;
    if (related instanceof globalThis.Node && root.contains(related)) return;
    scheduleHide();
  };

  const act = (run: (id: string) => void) => (event: MouseEvent) => {
    event.preventDefault();
    if (currentId) run(currentId);
    hide();
    view.focus();
  };

  const onAccept = act(actions.accept);
  const onReject = act(actions.reject);

  view.dom.addEventListener("mouseover", onOver);
  view.dom.addEventListener("mouseout", onOut);
  root.addEventListener("mouseenter", cancelHide);
  root.addEventListener("mouseleave", scheduleHide);
  accept.addEventListener("click", onAccept);
  reject.addEventListener("click", onReject);
  window.addEventListener("scroll", hide, true);

  return {
    showFor,
    hide,
    destroy: () => {
      cancelHide();
      view.dom.removeEventListener("mouseover", onOver);
      view.dom.removeEventListener("mouseout", onOut);
      accept.removeEventListener("click", onAccept);
      reject.removeEventListener("click", onReject);
      window.removeEventListener("scroll", hide, true);
      root.remove();
    },
  };
}
