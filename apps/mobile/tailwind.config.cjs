const tokens = require("../../packages/design-tokens/tokens.json");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}", "../../packages/ui-native/src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: { recall: tokens.color },
      spacing: Object.fromEntries(
        Object.entries(tokens.spacing).map(([name, pixels]) => [`recall-${name}`, `${pixels}px`]),
      ),
      borderRadius: Object.fromEntries(
        Object.entries(tokens.radius).map(([name, pixels]) => [`recall-${name}`, `${pixels}px`]),
      ),
    },
  },
  plugins: [],
};
