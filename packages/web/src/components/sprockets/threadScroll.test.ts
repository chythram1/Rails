import { describe, expect, it } from "vitest";
import { followAfterScroll, keepInSight, roomToSeat, seatOnSend, seatTop, spacerHeight } from "./threadScroll.ts";

describe("thread scrolling", () => {
  it("seats a sent message at the top unless over half the view is already empty below the messages", () => {
    // Scrolled to the end of a long conversation: nothing empty below.
    expect(seatOnSend({ scrollTop: 2000, viewport: 600, contentEnd: 2600 })).toBe(true);
    // Scrolled up to read: the end is below the view.
    expect(seatOnSend({ scrollTop: 500, viewport: 600, contentEnd: 2600 })).toBe(true);
    // A short reply left 400 of 600 px empty: the next one has room where it is.
    expect(seatOnSend({ scrollTop: 2000, viewport: 600, contentEnd: 2200 })).toBe(false);
    // A new chat with one short exchange.
    expect(seatOnSend({ scrollTop: 0, viewport: 600, contentEnd: 120 })).toBe(false);
  });

  it("seats a message a little below the top, or the chat's first one at the very top, so the intro line shows", () => {
    expect(seatTop(900, false)).toBe(884);
    // The first message sits under the line that says where the chat begins (24px padding, the line, its margin).
    expect(seatTop(56, true)).toBe(0);
  });

  it("reserves enough room to bring a message to the top, then gives it up as the reply grows", () => {
    const room = roomToSeat(1800, { viewport: 600, contentEnd: 1900 });
    expect(room).toBe(500); // content + room - viewport = 1800: the message can sit at the top
    const page = { room, contentAt: 1900 };
    expect(spacerHeight(page, 1900)).toBe(500);
    expect(spacerHeight(page, 2150)).toBe(250); // the reply grew 250 px into it
    expect(spacerHeight(page, 2600)).toBe(0); // and past it
    expect(spacerHeight(null, 2600)).toBe(0);
    expect(roomToSeat(100, { viewport: 600, contentEnd: 2000 })).toBe(0); // already enough content below
  });

  it("follows new messages unless the user scrolled up to read earlier ones, until they're back near the end", () => {
    const g = (scrollTop: number) => ({ scrollTop, viewport: 500, contentEnd: 2000 });
    expect(followAfterScroll(true, 1500, g(1200))).toBe(false); // scrolled up
    expect(followAfterScroll(true, 1000, g(1200))).toBe(true); // scrolling down through a long reply
    expect(followAfterScroll(false, 1000, g(1200))).toBe(false); // still above the end
    expect(followAfterScroll(false, 1200, g(1460))).toBe(true); // back within 48px of the end
    expect(followAfterScroll(false, 1700, g(1600))).toBe(true); // in the room reserved below the messages
  });

  it("keeps new replies in sight without passing the newest's top", () => {
    const g = { scrollTop: 100, viewport: 500, contentEnd: 900 };
    expect(keepInSight(700, g)).toBe(400); // short newest: its end at the bottom
    expect(keepInSight(300, g)).toBe(284); // long newest: its top (with the gap) at the top
    expect(keepInSight(50, g)).toBe(100); // never back up
  });
});
