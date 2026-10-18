import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";

type Notebook = NonNullable<KnowledgeNotebookModel["notebook"]>;
type Reference = NonNullable<
  KnowledgeNotebookModel["pendingProposals"][number]["sourceReferences"]
>[number];
type Props = {
  readonly references: readonly Reference[];
  readonly materials: Notebook["materials"];
  readonly onOpen: (sectionId: string) => void;
};
export function NotebookSuggestionSources({ references, materials, onOpen }: Props) {
  return (
    <>
      {references.map((reference, index) => (
        <SourceReference key={index} reference={reference} materials={materials} onOpen={onOpen} />
      ))}
    </>
  );
}
function SourceReference({
  reference,
  materials,
  onOpen,
}: Omit<Props, "references"> & { readonly reference: Reference }) {
  const material = materials?.find((item) => item.id === reference.materialId);
  const section = material?.sections.find((item) => item.id === reference.sectionId);
  return (
    <section>
      <h3 className="text-sm font-semibold leading-6">
        Source: {material?.name}
        {reference.pageNumber ? ` · page ${String(reference.pageNumber)}` : ""}
      </h3>
      <div className="space-y-4 pt-3">
        <blockquote>
          <p className="whitespace-pre-wrap">{reference.quote}</p>
          <a
            href={`#study-source-${reference.sectionId}`}
            onClick={(event) => {
              event.preventDefault();
              onOpen(reference.sectionId);
            }}
          >
            {material?.name} · {section?.title}
            {reference.pageNumber ? ` · page ${String(reference.pageNumber)}` : ""} · open source
            passage
          </a>
        </blockquote>
      </div>
    </section>
  );
}
