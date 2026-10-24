import { useEffect, useState } from "react";
import { IconCheck as Check, IconCopy as Copy } from "@tabler/icons-react";
import { copyText, timeAgoLong } from "../../util.ts";

/**
 * A chat message's details: when it was sent and a copy button, beside its bubble (under a card or event). They
 * always take their space (so nothing shifts), and show while the pointer is on the message or a button in them
 * has focus (styles.css). Left of the user's messages they read time, copy; right of a reply, copy, time: the
 * copy button always next to the bubble.
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
