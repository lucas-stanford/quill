import type { CompanionsApi } from "./useCompanions";
import "./companions.css";

/**
 * The title-bar control that opens a companion. One button per document —
 * there are at most two, so a menu would be a click to reveal a choice of two.
 *
 * Renders nothing when the plan has no companions, which is the common case
 * and must not leave a gap in the title bar.
 */
export function CompanionTabs({ companions }: { companions: CompanionsApi }) {
  const { available, loading, show } = companions;
  if (available.length === 0) return null;

  return (
    <div className="companion-tabs" role="group" aria-label="Reading material">
      {available.map((doc) => (
        <button
          key={doc.name}
          type="button"
          className="companion-tab"
          data-loading={loading === doc.name || undefined}
          onClick={() => show(doc.name)}
          title={`Read ${doc.name}`}
        >
          {doc.label}
        </button>
      ))}
    </div>
  );
}
