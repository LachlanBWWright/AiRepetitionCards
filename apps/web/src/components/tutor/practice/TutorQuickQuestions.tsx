"use client";
import type { ReactNode } from "react";
export function TutorQuickQuestions({ children }: { readonly children: ReactNode }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <section
          className="space-y-4 [&_[data-slot=label]]:grid [&_[data-slot=label]]:items-start [&_[data-slot=label]]:gap-2 [&_[data-slot=label]]:leading-[1.4] [&_[data-slot=textarea]]:w-full [&_[data-slot=input]]:w-full"
          aria-label="Quick questions"
        >
          {children}
        </section>
      </section>
    </div>
  );
}
