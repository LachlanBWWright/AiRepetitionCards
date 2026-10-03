import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { designTokens } from "@recall/design-tokens";
import { NativeAudioAttachment } from "./NativeAudioAttachment";
import type { Workspace, StudyCard } from "@recall/domain";
import type { ReviewRating } from "@recall/scheduler";

const palette = designTokens.color;

function dueNow(card: StudyCard, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}

function NativeButton({
  label,
  onPress,
  tone = "dark",
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone?: "dark" | "soft" | "rating";
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "dark" && styles.buttonDark,
        tone === "soft" && styles.buttonSoft,
        tone === "rating" && styles.buttonRating,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonLabel, tone === "soft" && styles.buttonLabelDark]}>{label}</Text>
    </Pressable>
  );
}

export type NativeTodayScreenProps = {
  readonly ready: boolean;
  readonly workspace: Workspace | null;
  readonly activeAreaId: string | null;
  readonly now: number;
  readonly dateLabel?: string;
  readonly message: string | null;
  readonly mediaUris?: Readonly<Record<string, string>>;
  readonly showAnswer: boolean;
  readonly canReset: boolean;
  readonly onSelectArea: (areaId: string) => void;
  readonly onHideAnswer: () => void;
  readonly onShowAnswer: () => void;
  readonly onReview: (rating: ReviewRating) => void;
  readonly onReset: () => void;
};

export function NativeTodayScreen({
  ready,
  workspace,
  activeAreaId,
  now,
  dateLabel,
  message,
  mediaUris = {},
  showAnswer,
  canReset,
  onSelectArea,
  onHideAnswer,
  onShowAnswer,
  onReview,
  onReset,
}: NativeTodayScreenProps) {
  if (!ready || !workspace) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={palette.darkGreen} size="large" />
        <Text style={styles.muted}>Loading your offline library…</Text>
      </SafeAreaView>
    );
  }

  const activeArea = workspace.areas.find((area) => area.id === activeAreaId) ?? workspace.areas[0];
  const dueCards = activeArea?.cards.filter((item) => dueNow(item, now)) ?? [];
  const card = dueCards[0];
  const totalDue = activeArea?.cards.filter((item) => dueNow(item, now)).length ?? 0;
  const totalReviews = workspace.reviews;
  const displayedDate =
    dateLabel ??
    new Date(now).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <SafeAreaView testID="mobile-screen" style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.topBar}>
          <View style={styles.brandMark}>
            <Text style={styles.brandGlyph}>R</Text>
          </View>
          <Text style={styles.brand}>Recall</Text>
          <View style={styles.offlineBadge}>
            <View style={styles.onlineDot} />
            <Text style={styles.offlineText}>OFFLINE READY</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>YOUR STUDY SPACE</Text>
        <View style={styles.headingRow}>
          <Text style={styles.title}>Today</Text>
          <Text style={styles.date}>{displayedDate}</Text>
        </View>

        {workspace && workspace.areas.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.areaList}
          >
            {workspace.areas.map((area) => (
              <Pressable
                key={area.id}
                onPress={() => {
                  onSelectArea(area.id);
                  onHideAnswer();
                }}
                style={[styles.areaChip, area.id === activeArea?.id && styles.areaChipSelected]}
              >
                <View style={[styles.areaDot, { backgroundColor: area.color }]} />
                <Text
                  style={[
                    styles.areaChipText,
                    area.id === activeArea?.id && styles.areaChipTextSelected,
                  ]}
                >
                  {area.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View style={styles.statsCard}>
          <View>
            <Text style={styles.statsLabel}>DUE NOW</Text>
            <Text style={styles.statsValue}>{totalDue}</Text>
            <Text style={styles.statsHint}>cards ready to review</Text>
          </View>
          <View style={styles.statsDivider} />
          <View>
            <Text style={styles.statsLabel}>REVIEWS</Text>
            <Text style={styles.statsValue}>{totalReviews}</Text>
            <Text style={styles.statsHint}>in this library</Text>
          </View>
          <View style={styles.statsOrb}>
            <Text style={styles.orbGlyph}>✳</Text>
          </View>
        </View>

        {message && (
          <Text accessibilityRole="alert" style={styles.notice}>
            {message}
          </Text>
        )}

        {card ? (
          <View style={styles.studySection}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{activeArea?.title ?? "Study"}</Text>
              <Text style={styles.queueCount}>{dueCards.length} DUE</Text>
            </View>
            <View style={styles.studyCard}>
              <View style={styles.cardMeta}>
                <Text style={styles.cardLabel}>{showAnswer ? "ANSWER" : "QUESTION"}</Text>
                <Text style={styles.cardObjective}>{card.objective}</Text>
              </View>
              <Text style={styles.cardText}>{showAnswer ? card.back : card.front}</Text>
              {card.media?.map((reference) => {
                const uri = mediaUris[reference.id];
                if (!uri) return null;
                return reference.mimeType.startsWith("image/") ? (
                  <Image
                    key={reference.id}
                    source={{ uri }}
                    accessibilityLabel="Study card image attachment"
                    alt="Study card image attachment"
                    resizeMode="contain"
                    style={styles.mediaImage}
                  />
                ) : (
                  <NativeAudioAttachment key={reference.id} uri={uri} />
                );
              })}
              {showAnswer ? (
                <View style={styles.ratingList}>
                  {(
                    [
                      ["again", "Again", palette.coral],
                      ["hard", "Hard", palette.amber],
                      ["good", "Good", palette.green],
                      ["easy", "Easy", palette.violet],
                    ] as const
                  ).map(([rating, label, color]) => (
                    <Pressable
                      key={rating}
                      accessibilityRole="button"
                      onPress={() => onReview(rating)}
                      style={[styles.ratingButton, { backgroundColor: color }]}
                    >
                      <Text style={styles.ratingText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <NativeButton label="Show answer" onPress={() => onShowAnswer()} />
              )}
            </View>
          </View>
        ) : (
          <View style={styles.caughtUp}>
            <View style={styles.caughtUpIcon}>
              <Text style={styles.caughtUpGlyph}>✓</Text>
            </View>
            <Text style={styles.caughtUpTitle}>You’re all caught up</Text>
            <Text style={styles.caughtUpBody}>
              There are no cards due in {activeArea?.title ?? "this area"}. Come back later for your
              next review.
            </Text>
          </View>
        )}

        <View style={styles.librarySection}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Learning areas</Text>
            <Text style={styles.libraryCount}>{workspace?.areas.length ?? 0} AREAS</Text>
          </View>
          {workspace?.areas.map((area) => {
            const areaDue = area.cards.filter((item) => dueNow(item, now)).length;
            return (
              <Pressable
                key={area.id}
                onPress={() => {
                  onSelectArea(area.id);
                  onHideAnswer();
                }}
                style={styles.areaRow}
              >
                <View style={[styles.areaAccent, { backgroundColor: area.color }]} />
                <View style={styles.areaDetails}>
                  <Text style={styles.areaName}>{area.title}</Text>
                  <Text style={styles.areaCardCount}>{area.cards.length} cards</Text>
                </View>
                <Text style={styles.areaDueCount}>{areaDue} due</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          })}
          <NativeButton
            label="Reset sample library"
            onPress={onReset}
            tone="soft"
            disabled={!canReset}
          />
        </View>
        <Text style={styles.footer}>
          Your cards and review history stay on this device until you choose to sync.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.paper },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: palette.paper,
  },
  screen: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 48,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  topBar: { flexDirection: "row", alignItems: "center", marginBottom: 34 },
  brandMark: {
    height: 34,
    width: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.green,
  },
  brandGlyph: { color: palette.darkGreen, fontSize: 22, fontWeight: "800" },
  brand: {
    marginLeft: 10,
    color: palette.ink,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  offlineBadge: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  onlineDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: palette.darkGreen },
  offlineText: { fontSize: 9, color: palette.muted, fontWeight: "800", letterSpacing: 0.8 },
  eyebrow: {
    color: palette.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 7,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    color: palette.ink,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "700",
    letterSpacing: -1.7,
  },
  date: { color: palette.muted, fontSize: 13, paddingBottom: 7 },
  areaList: { gap: 8, paddingBottom: 16 },
  areaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  areaChipSelected: { backgroundColor: palette.ink, borderColor: palette.ink },
  areaDot: { width: 8, height: 8, borderRadius: 4 },
  areaChipText: { color: palette.ink, fontWeight: "600", fontSize: 12 },
  areaChipTextSelected: { color: palette.surface },
  statsCard: {
    minHeight: 142,
    borderRadius: 25,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.ink,
    overflow: "hidden",
    position: "relative",
  },
  statsLabel: { color: "#b8b9b2", fontSize: 9, letterSpacing: 1.4, fontWeight: "800" },
  statsValue: {
    color: palette.surface,
    fontSize: 42,
    lineHeight: 49,
    fontWeight: "600",
    marginTop: 5,
  },
  statsHint: { color: "#b8b9b2", fontSize: 11 },
  statsDivider: { height: 62, width: 1, backgroundColor: "#4a4c43", marginHorizontal: 26 },
  statsOrb: {
    position: "absolute",
    height: 116,
    width: 116,
    borderRadius: 58,
    backgroundColor: "#c4ed681f",
    right: -23,
    bottom: -37,
    alignItems: "center",
    justifyContent: "center",
  },
  orbGlyph: { fontSize: 64, color: palette.green, marginTop: -20 },
  notice: {
    color: palette.darkGreen,
    fontSize: 12,
    backgroundColor: "#eaf3d9",
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    lineHeight: 18,
  },
  studySection: { marginTop: 30 },
  sectionHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 13,
  },
  sectionTitle: { color: palette.ink, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  queueCount: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  studyCard: {
    borderRadius: 28,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    padding: 23,
    minHeight: 260,
    justifyContent: "space-between",
  },
  cardMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardLabel: { color: palette.darkGreen, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  cardObjective: { color: palette.muted, fontSize: 10 },
  cardText: {
    color: palette.ink,
    fontSize: 23,
    lineHeight: 32,
    fontWeight: "500",
    marginVertical: 28,
  },
  mediaImage: {
    width: "100%",
    height: 220,
    borderRadius: 14,
    marginVertical: 18,
    backgroundColor: palette.green,
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 15,
  },
  buttonDark: { backgroundColor: palette.ink },
  buttonSoft: { backgroundColor: "#f0efe9", marginTop: 8 },
  buttonRating: { flex: 1, minWidth: "45%" },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
  buttonLabel: { color: palette.surface, fontSize: 13, fontWeight: "700" },
  buttonLabelDark: { color: palette.ink },
  ratingList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ratingButton: {
    flexGrow: 1,
    flexBasis: "45%",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 47,
    borderRadius: 14,
  },
  ratingText: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  caughtUp: {
    minHeight: 240,
    marginTop: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    borderColor: palette.line,
    borderWidth: 1,
    backgroundColor: palette.surface,
    padding: 28,
  },
  caughtUpIcon: {
    height: 42,
    width: 42,
    borderRadius: 21,
    backgroundColor: palette.green,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  caughtUpGlyph: { fontSize: 22, color: palette.darkGreen, fontWeight: "800" },
  caughtUpTitle: { color: palette.ink, fontSize: 19, fontWeight: "700" },
  caughtUpBody: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 300,
  },
  librarySection: { marginTop: 31 },
  libraryCount: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  areaRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopColor: palette.line,
    borderTopWidth: 1,
    paddingVertical: 15,
  },
  areaAccent: { height: 35, width: 5, borderRadius: 4, marginRight: 12 },
  areaDetails: { flex: 1 },
  areaName: { color: palette.ink, fontSize: 13, fontWeight: "600" },
  areaCardCount: { color: palette.muted, fontSize: 10, marginTop: 3 },
  areaDueCount: { color: palette.muted, fontSize: 10, marginRight: 12 },
  chevron: { color: palette.muted, fontSize: 24, marginTop: -3 },
  footer: {
    color: palette.muted,
    fontSize: 10,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 29,
  },
  muted: { color: palette.muted, fontSize: 13 },
});
