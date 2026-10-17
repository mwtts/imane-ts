import { describe, expect, test } from "bun:test";
import { MEMBER_SYSTEM, MEMBER_TEAM, type NotificationMessage, type PublicMember } from "@imane/shared";
import { buildSequence, sanitize } from "./sequence";

const m = (role: string): PublicMember => ({ email: `${role}@t`, name: role, role, rolename: `${role}名` });
const leader = m("leader");
const csirt = m("csirt");
const staff = m("staff");

let seq = 0;
const ev = (over: Partial<NotificationMessage>): NotificationMessage => ({
  id: String(++seq),
  processId: 1,
  team: "t",
  sentDate: 1_000_000,
  level: 0,
  message: "",
  action: { id: "a", type: "action", name: "連絡" },
  from: leader,
  to: csirt,
  ...over,
});

const opts = { hideInactive: false, hideTalk: false, compact: false, stateName: (id: string) => `S${id}` };

describe("シーケンス図", () => {
  test("mermaid の構文文字を置き換える", () => {
    expect(sanitize("a;b#c<d>\ne")).toBe("a；b＃c＜d＞ e");
  });

  test("参加者に別名を付け、矢印・Cc・全員宛てを描く", () => {
    const text = buildSequence(
      [
        ev({
          message: "状況;確認",
          cc: [staff],
          action: { id: "a", type: "action", name: "連絡", attachments: ["1"] },
        }),
        ev({
          from: MEMBER_SYSTEM,
          to: MEMBER_TEAM,
          message: "開始",
          action: { id: "s0000", type: "notification", name: "通知" },
        }),
      ],
      [leader, csirt, staff],
      opts,
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("sequenceDiagram");
    expect(lines).toContain("participant p1 as leader名");
    expect(text).toContain("p1->>p2: ");
    expect(text).toContain("状況；確認");
    expect(text).toContain("<br/>[S1]");
    expect(text).toContain("p1-->>p3: ");
    expect(text).toContain("Note over p0,p3: ");
  });

  test("非表示の応答と、設定に応じて話し合い・非アクティブなロールを除く", () => {
    const events = [
      ev({ reply: { type: "hidden" } }),
      ev({ action: { id: "talk", type: "talk", name: "相談" }, to: staff }),
      ev({ message: "本題" }),
    ];
    const text = buildSequence(events, [leader, csirt, staff], { ...opts, hideTalk: true, hideInactive: true });
    expect(text).not.toContain("相談");
    expect(text).not.toContain("staff名");
    expect(text.split("\n").filter((l) => l.includes("->>"))).toHaveLength(1);
  });

  test("roles-order で並び順と表示ロールを指定できる", () => {
    const text = buildSequence([ev({})], [leader, csirt, staff], {
      ...opts,
      rolesOrder: [
        { role: "csirt", order: 1 },
        { role: "leader", order: 2 },
      ],
    });
    expect(text).toContain("participant p1 as csirt名");
    expect(text).toContain("participant p2 as leader名");
    expect(text).not.toContain("staff名");
    expect(text).toContain("p2->>p1: ");
  });
});
