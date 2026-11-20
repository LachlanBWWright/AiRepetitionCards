import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import localFont from "next/font/local";
import { AppUiProvider } from "@/components/ui/AppUiProvider";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Regular.ttf",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Latin.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Recall — remember what matters",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/recall-icon-192.png", apple: "/recall-icon-192.png" },
  description: "A calm, thoughtful space for spaced repetition and active learning.",
};

export const viewport: Viewport = { themeColor: "#0a1020" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Next applies the proxy nonce while rendering each incoming request.
  await connection();
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppUiProvider>{children}</AppUiProvider>
      </body>
    </html>
  );
}
