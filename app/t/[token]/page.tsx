import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getTracker } from "@/lib/store";
import TrackerPage from "./tracker-page";
import "../tracker.css";

// A student's tracker — the link sent on WhatsApp. Rendered on the server so it
// opens instantly and the WhatsApp preview shows the plan's title.

export const dynamic = "force-dynamic";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-trk",
  display: "swap",
});

type Props = { params: Promise<{ token: string }> };

export const viewport: Viewport = {
  themeColor: "#f3f5f6",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const found = await getTracker(token).catch(() => null);
  if (!found) return { title: "Tracker not found", robots: { index: false } };
  const { title, subtitle } = found.tracker;
  return {
    title,
    description: subtitle,
    openGraph: { title, description: subtitle },
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: Props) {
  const { token } = await params;
  const found = await getTracker(token);
  if (!found) notFound();
  return (
    <div className={jakarta.variable}>
      <TrackerPage token={token} tracker={found.tracker} initial={found.state} />
    </div>
  );
}
