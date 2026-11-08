import Link from "next/link";
import type { ReactNode } from "react";

// The app's frame: a 48px bar on the page ground over one centred column (true-black flat, with the
// landing page's type and palette). The right end says whether this page is live with the worker.

export type Connection = { tone: "live" | "wait" | "off" | "idle"; text: string };

export default function AppShell({
  current,
  connection,
  children,
}: {
  current: "videos" | "job";
  connection?: Connection;
  children: ReactNode;
}) {
  return (
    <div className="app app-page">
      <header className="app-bar">
        <div className="app-bar-in">
          <Link className="wm" href="/">AgentCast</Link>
          <nav aria-label="App">
            <Link href="/#top">New video</Link>
            <Link href="/jobs" aria-current={current === "videos" ? "page" : undefined}>Videos</Link>
            <Link href="/#faq">Help</Link>
          </nav>
          <span className="grow" />
          {connection && (
            <span className={`worker is-${connection.tone}`} role="status">
              <i aria-hidden="true" />
              <span>{connection.text}</span>
            </span>
          )}
        </div>
      </header>
      <main className="app-col">{children}</main>
    </div>
  );
}
