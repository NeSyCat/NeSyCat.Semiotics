import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
// Live design system — the REAL Admination DS files, referenced through the
// `admination-design-system` file: dependency (a node_modules symlink to the
// git submodule at vendor/Admination.02-Design). Imported here so Turbopack
// inlines the DS's nested @import url(…) chain (tokens → leaves → containers →
// layouts). Must come before globals.css so the editor's rules layer on top.
// Edit a token/component in the DS repo → this app changes. Light theme is the
// DS default (:root); no `.dark` class is applied.
import "admination-design-system/components/index.css";
import "./globals.css";
// KaTeX math fonts/styles — canvas labels (forms/points/lines) render as LaTeX.
import "katex/dist/katex.min.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NeSyCat — Semiotics editor",
  description:
    "The Semiotics editor: compose string diagrams, wire their points, round-trip JSON. Part of the NeSyCat project (nesycat.org).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
