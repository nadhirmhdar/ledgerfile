import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Sans, Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fonts for the visual refresh proposals (directions b and c). Self-hosted at build time by next/font, not preloaded, and only used under their direction.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });

export const metadata: Metadata = {
  title: "LedgerFile",
  description: "Trial balance to signed financial statements",
};

/** Development only: the look being tried, from the lf_direction cookie (a, b or c). Ignored in production. */
async function direction(): Promise<string | undefined> {
  if (process.env.NODE_ENV === "production") return undefined;
  const value = (await cookies()).get("lf_direction")?.value;
  return value === "a" || value === "b" || value === "c" ? value : undefined;
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-direction={await direction()}
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
