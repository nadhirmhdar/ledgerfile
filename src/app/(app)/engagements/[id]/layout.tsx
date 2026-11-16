/**
 * Room on the left for the engagement sidebar on wide screens. Each page draws EngagementNav itself, and the nav takes its place
 * in this column; on small screens it flows with the page as a scrolling bar.
 */
export default function EngagementLayout({ children }: { children: React.ReactNode }) {
  return <div className="relative lg:pl-60">{children}</div>;
}
