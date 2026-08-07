/**
 * options/PollList.tsx
 *
 * The answers to "what should we call this", at the end of the comment rail.
 *
 * A poll is not a mode and not a screen. It is asked for in the same round as
 * every other note and it comes back in the same place they do — below the
 * comments, because it is about the document rather than about any one line of
 * it and has no anchor to sit beside.
 *
 * It renders AFTER the rail's positioned layer on purpose. That layer places
 * every bubble against live text coordinates measured from its own top, so
 * anything stacked above it moves every anchor in the document.
 *
 * Rounds are newest first: the newest round answered the steering you last
 * gave. Older rounds stay, because what you rejected is part of the argument
 * and is what stops the agent offering it back to you.
 */
import type { OptionPoll } from "../types";
import type { OptionsApi } from "./useOptions";
import { useLabel } from "./apply";
import "./options.css";

export interface PollListProps {
  options: OptionsApi;
  /** Take this one — rewrites whatever the round was about. */
  onUse: (poll: OptionPoll, value: string) => void;
}

export function PollList({ options, onUse }: PollListProps) {
  if (options.polls.length === 0) return null;

  return (
    <section className="poll-list" aria-label="Name candidates">
      <h2 className="poll-list-title">Names</h2>
      {[...options.polls].reverse().map((poll, index) => (
        <Round
          key={poll.id}
          poll={poll}
          latest={index === 0}
          onChoose={(optionId) => options.choose(poll.id, optionId)}
          onDrop={(optionId, dropped) => options.drop(poll.id, optionId, dropped)}
          onUse={onUse}
        />
      ))}
    </section>
  );
}

interface RoundProps {
  poll: OptionPoll;
  latest: boolean;
  onChoose: (optionId: string) => void;
  onDrop: (optionId: string, dropped: boolean) => void;
  onUse: (poll: OptionPoll, value: string) => void;
}

function Round({ poll, latest, onChoose, onDrop, onUse }: RoundProps) {
  return (
    <section className="options-round" data-latest={latest || undefined}>
      <h3 className="options-round-head">
        <span className="options-round-subject">{describeTarget(poll)}</span>
        <span className="options-round-steering">
          {poll.steering ? `“${poll.steering}”` : "No steering"}
        </span>
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
                    onClick={() => onUse(poll, option.value)}
                    title={
                      poll.target?.kind === "text"
                        ? `Replace every mention of “${poll.target.value}”`
                        : "Make it the document's title"
                    }
                  >
                    {useLabel(poll.target)}
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

/** What a round was about, so an old round is never mistaken for a new one. */
function describeTarget(poll: OptionPoll): string {
  return poll.target?.kind === "text" ? poll.target.value : "Project title";
}
