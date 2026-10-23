import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexClerkProvider } from "@/components/ConvexClerkProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { isLocalStandalone } from "@/lib/localStandalone";
import { buildBootInlineScript } from "@/theme";
import "katex/dist/katex.min.css";
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
  title: { default: "Weftly — LaTeX workspace", template: "%s | Weftly" },
  applicationName: "Weftly",
  manifest: "/manifest.webmanifest",
  description: "Write LaTeX, compile PDFs and test file restorations after a failed build.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const local = isLocalStandalone();
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-[100dvh] bg-background font-sans text-foreground antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: buildBootInlineScript() }} />
        <ThemeProvider>
          {local ? (
            children
          ) : (
            <ConvexClerkProvider>{children}</ConvexClerkProvider>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
