"use client";

export default function FinalAnswer({ state }: { state: any }) {
  const finalAnswer = state?.final || state?.draft || "";
  
  if (!finalAnswer) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="text-center mb-3">
        <h2 className="text-2xl font-semibold mb-1 text-charcoal-text">
          {state?.final ? "Final Answer" : "Draft Answer"}
        </h2>
        {state?.final && (
          <span className="text-xs text-green-400 bg-green-950 px-2 py-1 rounded-full">
            ✓ Verified and ready
          </span>
        )}
      </div>
      <div className="text-sm whitespace-pre-wrap bg-charcoal-surface p-6 rounded-2xl border border-charcoal-border shadow-sm max-h-[300px] overflow-auto text-charcoal-text">
        {finalAnswer}
      </div>
    </section>
  );
}
