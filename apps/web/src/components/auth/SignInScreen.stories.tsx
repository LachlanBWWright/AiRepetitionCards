import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SignInScreen } from "./SignInScreen";

const meta = {
  title: "Screens/Sign In",
  component: SignInScreen,
  parameters: { layout: "fullscreen" },
  args: { demo: true, supabaseEnabled: true, chatGptEnabled: true },
} satisfies Meta<typeof SignInScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Configured: Story = { name: "Sign in · Apple, Google, and ChatGPT" };
export const Unconfigured: Story = {
  name: "Sign in · Supabase unavailable",
  args: { supabaseEnabled: false },
};
export const Retry: Story = {
  name: "Sign in · authorization cancelled",
  args: {
    initialMessage: "Apple or Google sign-in was cancelled. You can try again.",
  },
};
export const TemporarilyUnavailable: Story = {
  name: "Sign in · temporary provider outage",
  args: {
    initialMessage:
      "Apple or Google sign-in is temporarily unavailable. Please start again shortly.",
  },
};
export const SharedReturn: Story = {
  name: "Sign in · return to shared area",
  args: { next: "/shared/3dcce050-6d4c-4977-93fd-b59c4a414a4d" },
};
