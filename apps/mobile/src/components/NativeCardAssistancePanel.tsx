import { NativeButton } from "./ui/NativeButton";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import { inspectCardQuality } from "@recall/application";
import {
  CardRefinementResultSchema,
  CardInspectionResultSchema,
  type CardProposal,
  type CardRefinementInput,
  type CardRefinementResult,
  type CardInspectionResult,
} from "@recall/ai-core";

export type NativeCardAssistanceProps = {
  readonly content: CardProposal;
  readonly proposalOnly?: boolean;
  readonly disabled: boolean;
  readonly onRefine?:
    | ((
        mode: CardRefinementInput["mode"],
        instructions: string,
      ) => Promise<CardRefinementResult | null>)
    | undefined;
  readonly onInspect?: (() => Promise<CardInspectionResult | null>) | undefined;
  readonly onApply: (result: CardRefinementResult) => Promise<boolean>;
};

export function NativeCardAssistancePanel({
  content,
  proposalOnly = false,
  disabled,
  onRefine,
  onInspect,
  onApply,
}: NativeCardAssistanceProps) {
  const [expanded, setExpanded] = useState(false);
  const [custom, setCustom] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<CardRefinementInput["mode"]>("clearer");
  const [preview, setPreview] = useState<{
    readonly result: CardRefinementResult;
    readonly original: CardProposal;
  } | null>(null);
  const [inspection, setInspection] = useState<{
    readonly result: CardInspectionResult;
    readonly original: CardProposal;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
  }, [content.front, content.back, content.objectiveId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function invoke<A>(operation: () => Promise<A>): Promise<A | null> {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: operation,
          catch: () => ({
            message:
              "Card assistance could not complete. Your saved card has not been changed by this panel.",
          }),
        }),
      ),
    );
    if (!mounted.current) return null;
    if (Either.isLeft(result)) {
      setNotice(result.left.message);
      return null;
    }
    return result.right;
  }
  const local = Effect.runSync(Effect.either(inspectCardQuality(content)));
  const sameContent = (original: CardProposal) =>
    original.front === content.front &&
    original.back === content.back &&
    original.objectiveId === content.objectiveId;
  const visibleInspection =
    inspection && sameContent(inspection.original) ? inspection.result : null;
  const visiblePreview = preview && sameContent(preview.original) ? preview : null;
  const replacement =
    visiblePreview &&
    (visiblePreview.result.cards.length > 1 ||
      visiblePreview.result.cards.some(
        (card) =>
          card.meaningChanged || /\{\{c\d+::/.test(card.front) !== /\{\{c\d+::/.test(content.front),
      ));

  async function request(kind: "refine" | "inspect") {
    if (disabled || lock.current) return;
    lock.current = true;
    const epoch = generation.current;
    setWorking(true);
    setNotice(null);
    try {
      if (kind === "refine" && onRefine) {
        const result = await invoke(() => onRefine(mode, instructions));
        if (!mounted.current || generation.current !== epoch) return;
        const checked = Schema.decodeUnknownEither(CardRefinementResultSchema)(result);
        if (Either.isRight(checked)) setPreview({ result: checked.right, original: content });
        else setNotice("No validated refinement was returned. Your card has not changed.");
      } else if (kind === "inspect" && onInspect) {
        const result = await invoke(onInspect);
        if (!mounted.current || generation.current !== epoch) return;
        const checked = Schema.decodeUnknownEither(CardInspectionResultSchema)(result);
        if (Either.isRight(checked)) setInspection({ result: checked.right, original: content });
        else setNotice("No validated quality check was returned.");
      }
    } finally {
      lock.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  return (
    <View className={"gap-[10px]"}>
      {Either.isLeft(local) ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[13px] leading-[19px]"}>
          {local.left.message}
        </Text>
      ) : (
        local.right.map((finding, index) => (
          <Text key={index} className={"text-recall-muted text-[13px] leading-[19px]"}>
            {finding.explanation} {finding.suggestion}
          </Text>
        ))
      )}
      <NativeButton
        label={expanded ? "Close improvements" : "Improve"}
        onPress={() => setExpanded(!expanded)}
        disabled={working}
        className={"p-[10px] bg-transparent"}
        labelClassName="text-recall-surface text-[12px] font-bold"
      />
      {expanded ? (
        <View className={"gap-[10px]"}>
          <Text className={"text-recall-muted text-[13px] leading-[19px]"}>
            Send this card and any source passages to your AI provider for suggestions.
          </Text>
          <NativeButton
            label="Check quality"
            onPress={() => void request("inspect")}
            disabled={disabled || working || !onInspect}
            className={"p-[10px] bg-transparent"}
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
          {visibleInspection ? (
            <View>
              <Text className={"text-recall-ink text-[14px]"}>{visibleInspection.summary}</Text>
              {visibleInspection.findings.map((finding, index) => (
                <View key={index}>
                  <Text className={"text-recall-ink text-[14px]"}>{finding.explanation}</Text>
                  <Text className={"text-recall-muted text-[13px] leading-[19px]"}>
                    {finding.suggestion}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <View className={"flex-row flex-wrap gap-[6px]"}>
            {(["clearer", "shorter", "split", "example", "cloze"] as const).map((value) => (
              <NativeButton
                key={value}
                label={`${mode === value ? "✓ " : ""}${value === "clearer" ? "Make clearer" : value === "shorter" ? "Shorten" : value === "split" ? "Split question" : value === "example" ? "Add example" : "Convert to cloze"}`}
                onPress={() => setMode(value)}
                disabled={disabled || working}
                className={"p-[10px] bg-transparent"}
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
            ))}
          </View>
          <NativeButton
            label={custom ? "Hide instructions" : "Custom instructions"}
            onPress={() => setCustom(!custom)}
            className={"p-[10px] bg-transparent"}
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
          {custom ? (
            <TextInput
              accessibilityLabel="Optional card refinement instructions"
              placeholder="Optional instructions"
              value={instructions}
              onChangeText={setInstructions}
              editable={!disabled && !working}
              maxLength={1000}
              multiline
              className={"p-[10px] bg-recall-paper text-recall-ink rounded-[8px]"}
            />
          ) : null}
          <NativeButton
            label="Suggest changes"
            onPress={() => void request("refine")}
            disabled={disabled || working || !onRefine}
            className={"p-[10px] bg-transparent"}
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
          {visiblePreview ? (
            <View className={"gap-[10px]"}>
              <Text className={"text-recall-ink text-[14px] font-bold"}>Original</Text>
              <Text selectable className={"text-recall-ink text-[14px]"}>
                {visiblePreview.original.front}
              </Text>
              <Text selectable className={"text-recall-muted text-[13px] leading-[19px]"}>
                {visiblePreview.original.back}
              </Text>
              <Text className={"text-recall-ink text-[14px] font-bold"}>Proposed changes</Text>
              {visiblePreview.result.cards.map((card, index) => (
                <View key={index} className={"gap-[10px]"}>
                  <Text selectable className={"text-recall-ink text-[14px]"}>
                    {card.front}
                  </Text>
                  <Text selectable className={"text-recall-ink text-[14px]"}>
                    {card.back}
                  </Text>
                  {detailsVisible ? (
                    <View>
                      <Text className={"text-recall-muted text-[13px] leading-[19px]"}>
                        {card.rationale}
                      </Text>
                      {card.sourceReferences.map((reference, sourceIndex) => (
                        <Text
                          key={sourceIndex}
                          selectable
                          className={"text-recall-muted text-[13px] leading-[19px]"}
                        >
                          {reference.pageNumber ? `Page ${reference.pageNumber}: ` : ""}
                          {reference.quote}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
              <NativeButton
                label={detailsVisible ? "Hide reasons and sources" : "Reasons and sources"}
                onPress={() => setDetailsVisible(!detailsVisible)}
                className={"p-[10px] bg-transparent"}
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
              <Text className={"text-recall-muted text-[13px] leading-[19px]"}>
                {proposalOnly
                  ? "Review each proposal before adding it to your deck."
                  : replacement
                    ? "Replacement cards start fresh schedules. Original review history remains preserved."
                    : "Apply to your draft, then save."}
              </Text>
              <NativeButton
                label={
                  proposalOnly
                    ? "Keep refined proposals"
                    : replacement
                      ? "Approve replacements"
                      : "Apply to draft"
                }
                disabled={disabled || working}
                onPress={() => {
                  if (lock.current) return;
                  lock.current = true;
                  setWorking(true);
                  void invoke(() => onApply(visiblePreview.result))
                    .then((applied) => {
                      if (applied && mounted.current) {
                        setPreview(null);
                        setInspection(null);
                      }
                    })
                    .finally(() => {
                      lock.current = false;
                      if (mounted.current) setWorking(false);
                    });
                }}
                className={"p-[10px] bg-transparent"}
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
              <NativeButton
                label="Discard refinement"
                onPress={() => setPreview(null)}
                disabled={disabled || working}
                className={"p-[10px] bg-transparent"}
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
            </View>
          ) : preview ? (
            <Text className={"text-recall-muted text-[13px] leading-[19px]"}>
              The card changed after this preview. Request a new refinement.
            </Text>
          ) : null}
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[13px] leading-[19px]"}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
