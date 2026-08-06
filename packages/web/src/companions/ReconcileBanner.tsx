/**
 * companions/ReconcileBanner.tsx
 *
 * A quiet line saying the plan may no longer follow from the research.
 *
 * It does not move the page. The plan's geometry is load-bearing — comment
 * bubbles are positioned against live text coordinates and the ribbon and
 * review bar both overlay rather than occupy — so a strip that pushed the
 * document down would shift every anchor for a message nobody asked for. It is
 * pinned over the canvas, above the review bar, and it is dismissible.
 *
 * It states what happened and offers the two honest answers: check the plan
 * against the new research, or accept that it still holds.
 */
import "./companions.css";

export interface ReconcileBannerProps {
  /** The document whose implications moved, or null when nothing has. */
  stale: string | null;
  /** Open the ordinary revision flow, pre-seeded with what changed. */
  onRecheck: () => void;
  /** The plan still holds — stop asking about this version of the research. */
  onAccept: () => void;
}

export function ReconcileBanner({ stale, onRecheck, onAccept }: ReconcileBannerProps) {
  if (stale === null) return null;

  return (
    <div className="reconcile-banner" role="status">
      <span className="reconcile-text">
        <strong>{stale}</strong> now says something different. The plan was argued from
        its implications.
      </span>
      <button type="button" className="reconcile-action" onClick={onRecheck}>
        Re-check the plan
      </button>
      <button type="button" className="reconcile-action" onClick={onAccept}>
        It still holds
      </button>
    </div>
  );
}
