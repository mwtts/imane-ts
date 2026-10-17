import { describe, expect, test } from "bun:test";
import { type CardData, MEMBER_SYSTEM, MEMBER_TEAM } from "@imane/shared";
import { WorkflowInstance } from "../src/engine/workflow";
import { find, harness, pub, TEAM } from "./fixtures";

const ASK: CardData = { id: "ASK", type: "action", name: "問い合わせ", roles: ["leader"] };

describe("アクションの受付と応答", () => {
  test("自動応答ユーザ宛ての action はキューに入り、delay 経過後にリプライが返る", () => {
    const h = harness({
      actions: [ASK],
      replies: [{ actionid: "ASK", to: "csirt", name: "了解", delay: 5, addstate: ["S1"], state: "ST1" }],
    });
    const leader = pub(find(h.scenario, "leader"));
    const csirt = pub(find(h.scenario, "csirt"));

    h.inst.requestAction(ASK, leader, csirt, []);
    expect(h.published).toHaveLength(1);
    expect(h.inst.queueEntries()).toHaveLength(1);

    h.clock.advance(4);
    h.inst.tick();
    expect(h.published).toHaveLength(1);

    h.clock.advance(1);
    h.inst.tick();
    expect(h.published).toHaveLength(2);
    const reply = h.published[1]!;
    expect(reply.reply?.name).toBe("了解");
    expect(reply.from.role).toBe("csirt");
    expect(reply.to.role).toBe("leader");
    expect(reply.replyTo?.id).toBe(h.published[0]!.id);
    expect(h.inst.queueEntries()).toHaveLength(0);
    expect(h.inst.systemStates().find((s) => s.id === "S1")).toBeUndefined(); // 未定義ステートは一覧に出ない
    expect(h.inst.ownedStates(leader.email)).toContain("ST1");
  });

  test("参加者宛てのアクションは即時に配信され、アクションのステート変更が適用される", () => {
    const card: CardData = { id: "TELL", type: "action", name: "連絡", roles: ["all"], addstate: ["S2"] };
    const h = harness({ actions: [card], states: [{ id: "S2", name: "連絡済" }] });
    h.inst.requestAction(card, pub(find(h.scenario, "leader")), pub(find(h.scenario, "staff")), []);
    expect(h.published).toHaveLength(1);
    expect(h.published[0]!.replyDate).toBe(h.clock.now());
    expect(h.inst.queueEntries()).toHaveLength(0);
    expect(h.inst.systemStates().find((s) => s.id === "S2")?.when).toBe(h.clock.now());
  });

  test("talk は自動応答ユーザ宛てでもキューに入らない", () => {
    const h = harness();
    const talk = h.scenario.actions.find((a) => a.id === "talk")!;
    h.inst.requestAction(talk, pub(find(h.scenario, "leader")), pub(find(h.scenario, "csirt")), []);
    expect(h.inst.queueEntries()).toHaveLength(0);
  });

  test("リプライが定義されていなければエラー応答を返す", () => {
    const h = harness({ actions: [ASK] });
    h.inst.requestAction(ASK, pub(find(h.scenario, "leader")), pub(find(h.scenario, "csirt")), []);
    h.clock.advance(5);
    h.inst.tick();
    expect(h.published[1]?.reply?.type).toBe("notfound");
    expect(h.inst.queueEntries()).toHaveLength(0);
  });

  test("オーダー付きリプライは順に返され、2通目の delay は元のアクションから数える", () => {
    const h = harness({
      actions: [ASK],
      replies: [
        { actionid: "ASK", to: "csirt", name: "受付", order: 0, delay: 0 },
        { actionid: "ASK", to: "csirt", name: "完了", order: 1, delay: 30 },
      ],
    });
    h.inst.requestAction(ASK, pub(find(h.scenario, "leader")), pub(find(h.scenario, "csirt")), []);
    h.inst.tick();
    expect(h.published.at(-1)?.reply?.name).toBe("受付");
    expect(h.inst.queueEntries()[0]?.order).toBe(1);

    h.clock.advance(29);
    h.inst.tick();
    expect(h.published).toHaveLength(2);
    h.clock.advance(1);
    h.inst.tick();
    expect(h.published.at(-1)?.reply?.name).toBe("完了");
    expect(h.inst.queueEntries()).toHaveLength(0);
  });

  test("statecondition を満たすまでリプライを保留する", () => {
    const open: CardData = { id: "OPEN", type: "action", name: "開放", roles: ["all"], addstate: ["S9"] };
    const h = harness({
      actions: [ASK, open],
      replies: [{ actionid: "ASK", to: "csirt", name: "対応", statecondition: ["S9"] }],
    });
    const leader = pub(find(h.scenario, "leader"));
    h.inst.requestAction(ASK, leader, pub(find(h.scenario, "csirt")), []);
    h.inst.tick();
    expect(h.published).toHaveLength(1);

    h.inst.requestAction(open, leader, pub(find(h.scenario, "staff")), []);
    h.inst.tick();
    expect(h.published.at(-1)?.reply?.name).toBe("対応");
  });

  test("中止系アクションは対象アクションをキューから除く", () => {
    const long: CardData = { id: "LONG", type: "action", name: "調査", roles: ["all"] };
    const stop: CardData = { id: "STOP", type: "action", name: "調査中止", roles: ["all"], abortaction: "LONG" };
    const h = harness({
      actions: [long, stop],
      replies: [
        { actionid: "LONG", to: "csirt", name: "調査結果", delay: 100 },
        { actionid: "STOP", to: "csirt", name: "中止しました", delay: 0 },
      ],
    });
    const leader = pub(find(h.scenario, "leader"));
    const csirt = pub(find(h.scenario, "csirt"));
    expect(() => h.inst.requestAction(stop, leader, csirt, [])).toThrow("中止することはできません");

    h.inst.requestAction(long, leader, csirt, []);
    h.inst.requestAction(stop, leader, csirt, []);
    h.inst.tick();
    expect(h.inst.queueEntries()).toHaveLength(0);
    h.clock.advance(200);
    h.inst.tick();
    expect(h.published.some((m) => m.reply?.name === "調査結果")).toBe(false);
  });

  test("自動応答ユーザからのリプライには Cc を付けない", () => {
    const h = harness({ actions: [ASK], replies: [{ actionid: "ASK", to: "csirt", name: "了解" }] });
    h.inst.requestAction(ASK, pub(find(h.scenario, "leader")), pub(find(h.scenario, "csirt")), [
      pub(find(h.scenario, "staff")),
    ]);
    expect(h.published[0]!.cc).toHaveLength(1);
    h.inst.tick();
    expect(h.published[1]!.cc).toBeUndefined();
  });

  test("演習が開始されていなければアクションを拒否する", () => {
    const h = harness({ actions: [ASK] }, false);
    expect(() =>
      h.inst.requestAction(ASK, pub(find(h.scenario, "leader")), pub(find(h.scenario, "csirt")), []),
    ).toThrow("演習が実行されていません");
  });
});

describe("自動アクション", () => {
  const AUTO: CardData = {
    id: "AUTO1",
    type: "auto",
    name: "攻撃",
    from: "attacker",
    to: "system",
    delay: 3,
    systemstatecondition: ["S1"],
    attachments: ["ST_ATTACK"],
  };
  const SET_S1: CardData = { id: "SET", type: "action", name: "設定", roles: ["all"], addstate: ["S1"] };

  const setup = () =>
    harness({
      actions: [AUTO, SET_S1],
      replies: [{ actionid: "AUTO1", to: "system", type: "hidden", addstate: ["S_AUTO"] }],
      states: [{ id: "S_AUTO" }, { id: "S1" }],
    });

  test("条件成立から delay 秒後に一度だけ実行される", () => {
    const h = setup();
    h.inst.tick();
    expect(h.published).toHaveLength(0);

    h.inst.requestAction(SET_S1, pub(find(h.scenario, "leader")), pub(find(h.scenario, "staff")), []);
    h.inst.tick();
    h.clock.advance(2);
    h.inst.tick();
    expect(h.published.filter((m) => m.action.id === "AUTO1")).toHaveLength(0);

    h.clock.advance(1);
    h.inst.tick();
    const fired = h.published.filter((m) => m.action.id === "AUTO1");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(fired[0]!.from.role).toBe("attacker");
    expect(h.inst.systemStates().find((s) => s.id === "S_AUTO")?.when).toBeDefined();
    expect(h.inst.summary().autoActionHistory.AUTO1).toBeDefined();

    const count = h.published.length;
    h.clock.advance(60);
    h.inst.tick();
    expect(h.published).toHaveLength(count);
  });

  test("中断すると待機中の自動アクションは実行されない", () => {
    const h = setup();
    h.inst.requestAction(SET_S1, pub(find(h.scenario, "leader")), pub(find(h.scenario, "staff")), []);
    h.inst.tick();
    h.inst.abort();
    h.clock.advance(10);
    h.inst.tick();
    expect(h.published.filter((m) => m.action.id === "AUTO1")).toHaveLength(0);
    expect(h.published.at(-1)?.message).toBe("演習ワークフローが中断されました。");
  });
});

describe("トリガーイベント", () => {
  test("フェーズ開始から elapsed 秒を過ぎると一度だけ発火し、from 省略時はシステムから送られる", () => {
    const h = harness({
      replies: [
        {
          actionid: "s0000",
          name: "演習開始",
          message: "開始します",
          elapsed: 3,
          state: "ST0",
          addstate: ["S0"],
          to: "all",
        },
      ],
      states: [{ id: "S0" }],
    });
    h.clock.advance(3);
    h.inst.tick();
    expect(h.published).toHaveLength(0);

    h.clock.advance(1);
    h.inst.tick();
    expect(h.published).toHaveLength(1);
    const ev = h.published[0]!;
    expect(ev.from.role).toBe(MEMBER_SYSTEM.role);
    expect(ev.to.role).toBe(MEMBER_TEAM.role);
    expect(ev.action.statecards).toContain("ST0");
    expect(ev.message).toBe("開始します");
    expect(h.inst.triggers()[0]?.fireWhen).toBe(h.clock.now());
    expect(h.inst.ownedStates(find(h.scenario, "staff").email)).toContain("ST0");

    h.clock.advance(10);
    h.inst.tick();
    expect(h.published).toHaveLength(1);
  });
});

describe("ポイントカード", () => {
  test("期間内に対象ステートが追加されると得点し、多重度を超えて得点しない", () => {
    const set: CardData = { id: "SET", type: "action", name: "設定", roles: ["all"], addstate: ["S1"] };
    const h = harness({
      actions: [set],
      states: [{ id: "S1" }],
      points: [
        { id: "early", state: "S1", point: 10, before: 60, multiplicity: 1, phase: -1 },
        { id: "late", state: "S1", point: 5, after: 100, multiplicity: 1, phase: -1 },
      ],
    });
    const leader = pub(find(h.scenario, "leader"));
    const staff = pub(find(h.scenario, "staff"));

    h.clock.advance(10);
    const msg = h.inst.requestAction(set, leader, staff, []);
    expect(h.inst.score).toBe(10);
    expect(h.inst.summary().pointchest[msg.id]?.map((p) => p.id)).toEqual(["early"]);

    h.clock.advance(100);
    h.inst.requestAction(set, leader, staff, []);
    expect(h.inst.score).toBe(15);

    h.inst.requestAction(set, leader, staff, []);
    expect(h.inst.score).toBe(15);
  });
});

describe("履歴", () => {
  test("ロールを指定すると送受信したイベントだけを返す", () => {
    const h = harness();
    const talk = h.scenario.actions.find((a) => a.id === "talk")!;
    const leader = pub(find(h.scenario, "leader"));
    const staff = pub(find(h.scenario, "staff"));
    const fac = pub(find(h.scenario, "facilitator"));
    h.inst.requestAction(talk, leader, staff, []);
    h.inst.requestAction(talk, fac, staff, [leader]);
    h.inst.requestAction(talk, fac, staff, []);
    h.inst.postTeamNotification("全員へ");
    expect(h.inst.historyFor("leader")).toHaveLength(3);
    expect(h.inst.historyFor()).toHaveLength(4);
  });
});

describe("スナップショット", () => {
  test("復元すると保存時からの経過時間だけ日時がずれ、一時停止状態になる。再開後も経過時間は保たれる", () => {
    const h = harness({ actions: [ASK], replies: [{ actionid: "ASK", to: "csirt", name: "了解", delay: 300 }] });
    h.inst.requestAction(ASK, pub(find(h.scenario, "leader")), pub(find(h.scenario, "csirt")), []);
    h.clock.advance(100);
    const snap = JSON.parse(JSON.stringify(h.inst.snapshot()));

    h.clock.advance(1000);
    const restored = WorkflowInstance.restore(snap, 2, {
      scenario: () => h.scenario,
      clock: h.clock,
      publish: () => {},
    });
    expect(restored.state).toBe("Suspended");
    expect(restored.team).toBe(TEAM);
    expect(h.clock.now() - restored.start!).toBe(100_000);
    expect(restored.queueEntries()).toHaveLength(1);

    h.clock.advance(50);
    restored.resume();
    expect(restored.state).toBe("Started");
    expect(h.clock.now() - restored.start!).toBe(100_000);

    h.clock.advance(199);
    restored.tick();
    expect(restored.queueEntries()).toHaveLength(1);
    h.clock.advance(1);
    restored.tick();
    expect(restored.queueEntries()).toHaveLength(0);
  });

  test("形式が違うデータは拒否する", () => {
    const h = harness();
    expect(() =>
      WorkflowInstance.restore({ team: TEAM } as never, 1, {
        scenario: () => h.scenario,
        clock: h.clock,
        publish: () => {},
      }),
    ).toThrow("形式が不正");
  });
});
