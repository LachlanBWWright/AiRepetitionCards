import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Recall — remember what matters",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/recall-icon-192.png", apple: "/recall-icon-192.png" },
  description: "A calm, thoughtful space for spaced repetition and active learning.",
};

export const viewport: Viewport = { themeColor: "#29322b" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Next applies the proxy nonce while rendering each incoming request.
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
