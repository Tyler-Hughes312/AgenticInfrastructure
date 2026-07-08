"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function RunRedirectContent({ runId }: { runId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const question = searchParams.get("question");

  useEffect(() => {
    if (runId === "new" && question) {
      router.replace(`/?question=${encodeURIComponent(question)}`);
      return;
    }
    router.replace(`/?runId=${encodeURIComponent(runId)}`);
  }, [runId, question, router]);

  return (
    <div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">
      Redirecting to workspace...
    </div>
  );
}

export default function RunPage({ params }: { params: { runId: string } }) {
  return (
    <Suspense fallback={<div className="h-screen bg-charcoal-bg text-charcoal-muted flex items-center justify-center">Loading...</div>}>
      <RunRedirectContent runId={params.runId} />
    </Suspense>
  );
}
