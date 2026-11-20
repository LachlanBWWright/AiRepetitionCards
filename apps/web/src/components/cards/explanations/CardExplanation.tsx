import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
import { CardRichText } from "../CardRichText";
import type { CardAppearance } from "@recall/domain";

export function CardExplanation({
  text,
  mediaUrls,
  appearance,
}: {
  readonly text: string;
  readonly mediaUrls?: Readonly<Record<string, string>>;
  readonly appearance?: CardAppearance | undefined;
}) {
  return (
    <Accordion type="single" collapsible className="mx-4 mb-4 text-left">
      <AccordionItem value="explanation">
        <AccordionTrigger>Explanation and supporting material</AccordionTrigger>
        <AccordionContent>
          <CardRichText text={text} mediaUrls={mediaUrls ?? {}} appearance={appearance} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
