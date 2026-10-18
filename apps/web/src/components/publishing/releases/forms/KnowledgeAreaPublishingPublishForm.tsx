"use client";

import type { ReactNode, SyntheticEvent } from "react";

type Props = {
  readonly title: string;
  readonly embedded: boolean;
  readonly onPublish: () => void;
  readonly children: ReactNode;
};

export function KnowledgeAreaPublishingPublishForm({
  title,
  embedded,
  onPublish,
  children,
}: Props) {
  return (
    <form
      className={`${embedded ? "" : "rounded-xl border p-5 "}flex flex-col items-stretch gap-3 [&>label]:grid [&>label]:gap-2 [&>label]:text-sm [&>label]:font-semibold`}
      onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        onPublish();
      }}
    >
      <h3 className="text-base font-semibold">Publish “{title}”</h3>
      {children}
    </form>
  );
}
