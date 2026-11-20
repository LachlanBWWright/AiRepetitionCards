import type { Preview } from "@storybook/nextjs-vite";
import { AppUiProvider } from "../src/components/ui/AppUiProvider";
import "../src/app/globals.css";
import "./native-preview.css";
import "./preview-fonts.css";

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <AppUiProvider>
        {context.parameters.nativePreview === true ? (
          <div data-native-preview className="min-h-screen bg-background text-foreground">
            <Story />
          </div>
        ) : (
          <Story />
        )}
      </AppUiProvider>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        recallMobile: {
          name: "Recall Mobile · 390 × 844",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        recallDesktop: {
          name: "Recall Desktop · 1440 × 1000",
          styles: { width: "1440px", height: "1000px" },
          type: "desktop",
        },
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
