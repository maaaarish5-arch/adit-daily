"use client";

// Renders SOP blocks — shared by Today, the corners and the SOP tab.

import { useState } from "react";
import type { SopBlock } from "@/lib/tasks";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy"
      data-copied={String(copied)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Creds({ label, user, pass }: { label: string; user: string; pass: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="creds">
      <span className="creds-label">{label}</span>
      <code>{user}</code>
      <code className="creds-pass">{shown ? pass : "••••••••"}</code>
      <button className="copy" onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Reveal"}
      </button>
    </div>
  );
}

export function Sop({ blocks }: { blocks: SopBlock[] }) {
  return (
    <div className="sop">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "p":
            return <p key={i}>{block.text}</p>;
          case "steps":
            return (
              <ol key={i} className="sop-steps">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            );
          case "script":
            return (
              <div key={i} className="script">
                <div className="script-head">
                  <span>{block.title}</span>
                  <CopyButton text={block.body} />
                </div>
                <pre>{block.body}</pre>
              </div>
            );
          case "link":
            return (
              <a
                key={i}
                className="sop-link"
                href={block.href}
                target="_blank"
                rel="noreferrer"
              >
                {block.label}
                <span>{block.href.replace(/^https?:\/\//, "")}</span>
              </a>
            );
          case "creds":
            return (
              <Creds key={i} label={block.label} user={block.user} pass={block.pass} />
            );
          case "warn":
            return (
              <p key={i} className="sop-warn">
                {block.text}
              </p>
            );
          case "pending":
            return (
              <p key={i} className="sop-pending">
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}
