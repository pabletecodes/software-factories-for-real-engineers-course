import { describe, it, expect } from "vitest";
import { createPushHub, type Nudge } from "./notification-push.server";

const nudge: Nudge = {
  title: "Emma Wilson asked a question",
  courseTitle: "Intro to TypeScript",
};

function stream() {
  const received: Nudge[] = [];
  return { received, send: (n: Nudge) => void received.push(n) };
}

describe("push hub", () => {
  it("sends a nudge to every open stream of each target user, and no one else's", () => {
    const hub = createPushHub();
    const aliceTab1 = stream();
    const aliceTab2 = stream();
    const bob = stream();
    const carol = stream();
    hub.subscribe(1, aliceTab1.send);
    hub.subscribe(1, aliceTab2.send);
    hub.subscribe(2, bob.send);
    hub.subscribe(3, carol.send);

    hub.publish([1, 2], nudge);

    expect(aliceTab1.received).toEqual([nudge]);
    expect(aliceTab2.received).toEqual([nudge]);
    expect(bob.received).toEqual([nudge]);
    expect(carol.received).toEqual([]);
  });

  it("sends nothing more to a stream once it unsubscribes", () => {
    const hub = createPushHub();
    const closed = stream();
    const open = stream();
    const unsubscribe = hub.subscribe(1, closed.send);
    hub.subscribe(1, open.send);

    unsubscribe();
    hub.publish([1], nudge);

    expect(closed.received).toEqual([]);
    expect(open.received).toEqual([nudge]);
  });

  it("drops a stream whose send fails, and still reaches the others", () => {
    const hub = createPushHub();
    let calls = 0;
    const broken = () => {
      calls++;
      throw new Error("stream closed");
    };
    const open = stream();
    hub.subscribe(1, broken);
    hub.subscribe(1, open.send);

    hub.publish([1], nudge);
    hub.publish([1], nudge);

    expect(calls).toBe(1);
    expect(open.received).toEqual([nudge, nudge]);
  });
});
