/**
 * options/OptionsPanel.tsx
 *
 * The naming poll: ask for candidates, weigh them, take one.
 *
 * An overlay over the shell, like the companion drawer and for the same
 * reason — the plan's editor keeps its pending tracked changes and its measured
 * comment anchors while you are in here, so looking at names costs nothing.
 *
 * Rounds are shown newest first, because the newest round is the one that
 * answered the steering you last gave. Older rounds stay: what you rejected is
 * part of the argument, and it is what stops the agent offering it again.
 */
import { useEffect, useRef, useState } from "react";
import type { OptionPoll } from "../types";
import type { OptionsApi } from "./useOptions";
import "./options.css";

export interface OptionsPanelProps {
  options: OptionsApi;
  open: boolean;
  onClose: () => void;
  /** Take this one — writes it into the document as its title. */
  onUse: (value: string) => void;
}

export function OptionsPanel({ options, open, onClose, onUse }: OptionsPanelProps) {
  const [steering, setSteering] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const busy = options.status === "queued" || options.status === "working";

  const send = () => {
    options.ask("name", steering);
    setSteering("");
  };

  return (
    <div className="options-scrim" onMouseDown={onClose}>
      <div
        className="options-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Name options"
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="options-head">
          <span className="options-title">Name options</span>
          {options.error ? (
            <span className="options-status">{options.error}</span>
          ) : busy ? (
            <span className="options-status" aria-live="polite">
              Asking the agent…
            </span>
          ) : null}
          <button
            type="button"
            className="companion-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="options-ask">
          <textarea
            className="options-steering"
            rows={2}
            value={steering}
            placeholder="Steer it, or leave blank — “one word, weird west, no compound words”"
            onChange={(event) => setSteering(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            aria-label="Steering for the agent"
          />
          <button
            type="button"
            className="companion-action companion-action--primary"
            onClick={send}
            disabled={busy}
          >
            {options.polls.length === 0 ? "Ask for names" : "Ask for more"}
          </button>
        </div>

        <div className="options-body">
          {options.polls.length === 0 ? (
            <p className="options-empty">
              No candidates yet. Ask, and steer it if you already know what you want —
              each round remembers what has been offered, so you never see the same
              name twice.
            </p>
          ) : (
            [...options.polls].reverse().map((poll, index) => (
              <Round
                key={poll.id}
                poll={poll}
                latest={index === 0}
                onChoose={(optionId) => options.choose(poll.id, optionId)}
                onDrop={(optionId, dropped) => options.drop(poll.id, optionId, dropped)}
                onUse={onUse}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface RoundProps {
  poll: OptionPoll;
  latest: boolean;
  onChoose: (optionId: string) => void;
  onDrop: (optionId: string, dropped: boolean) => void;
  onUse: (value: string) => void;
}

function Round({ poll, latest, onChoose, onDrop, onUse }: RoundProps) {
  return (
    <section className="options-round" data-latest={latest || undefined}>
      <h3 className="options-round-head">
        {poll.steering ? `“${poll.steering}”` : "No steering"}
        <span className="options-round-count">{poll.options.length}</span>
      </h3>

      <ul className="options-list">
        {poll.options.map((option) => {
          const chosen = poll.chosen === option.id;
          return (
            <li
              key={option.id}
              className="options-item"
              data-chosen={chosen || undefined}
              data-dropped={option.dropped || undefined}
            >
              <div className="options-item-main">
                <span className="options-value">{option.value}</span>
                {option.note ? <span className="options-note">{option.note}</span> : null}
              </div>
              <div className="options-item-actions">
                <button
                  type="button"
                  className="companion-action"
                  data-active={chosen || undefined}
                  onClick={() => onChoose(option.id)}
                  aria-pressed={chosen}
                  title={chosen ? "Un-pick it" : "This one"}
                >
                  {chosen ? "Picked" : "Pick"}
                </button>
                {chosen ? (
                  <button
                    type="button"
                    className="companion-action companion-action--primary"
                    onClick={() => onUse(option.value)}
                    title="Make it the document's title"
                  >
                    Use as title
                  </button>
                ) : null}
                <button
                  type="button"
                  className="companion-action"
                  onClick={() => onDrop(option.id, !option.dropped)}
                  title={
                    option.dropped
                      ? "Put it back in the running"
                      : "Rule it out — the agent will not offer it again"
                  }
                >
                  {option.dropped ? "Restore" : "Drop"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
