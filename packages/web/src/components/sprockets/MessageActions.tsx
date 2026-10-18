import { useEffect, useState } from "react";
import { IconCheck as Check, IconCopy as Copy } from "@tabler/icons-react";
import { copyText, timeAgoLong } from "../../util.ts";

/**
 * The row under a chat message (ref/sprockets/stage2/message.png): when it was sent and a copy button. The
 * row always takes its space (so messages sit apart and nothing shifts), and shows while the pointer is on
 * its message or a button in it has focus (styles.css). Under the user's messages it reads time, copy;
 * under a reply, copy, time, each starting from the message's own edge.
 */
export function MessageActions({ text, at, now, reply }: { text: string; at: string; now: number; reply: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const time = (
    <time className="sp-time" dateTime={at} title={new Date(at).toLocaleString()}>
      {timeAgoLong(at, now)}
    </time>
  );
  const copy = (
    <button className="icon-btn" aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy"} onClick={() => setCopied(copyText(text))}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
  return (
    <div className="sp-msg-actions">
      {reply ? copy : time}
      {reply ? time : copy}
      <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
    </div>
  );
}
