/** Stateful adapter capability; retained callbacks cannot cross reset/account cleanup boundaries. */
export function createNativeWorkspaceLifetime() {
  let generation = 0;
  let blocked = false;
  return {
    generation: () => generation,
    isBlocked: () => blocked,
    invalidate: () => {
      generation += 1;
      return generation;
    },
    pauseWrites: () => {
      blocked = true;
    },
    resumeWrites: () => {
      blocked = false;
    },
  } as const;
}
