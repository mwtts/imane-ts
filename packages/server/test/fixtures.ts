import type { CardData, NotificationMessage, PointCard, ReplyData, ScenarioSetting, StateData } from "@imane/shared";
import { WorkflowInstance, type Clock } from "../src/engine/workflow";
import type { Member, Scenario } from "../src/scenario/loader";

export class FakeClock implements Clock {
  constructor(public t = 1_000_000) {}
  now(): number {
    return this.t;
  }
  advance(seconds: number): void {
    this.t += seconds * 1000;
  }
}

export const TEAM = "t1";

export function member(role: string, system: boolean, extra: Partial<Member> = {}): Member {
  return { email: `${role}@${TEAM}`, name: role, role, rolename: role, team: TEAM, system: [system], ...extra };
}

export const MEMBERS: Member[] = [
  member("leader", false),
  member("staff", false),
  member("csirt", true),
  member("attacker", true),
  member("facilitator", false, { isadmin: true }),
];

export interface ScenarioParts {
  actions?: CardData[];
  replies?: ReplyData[];
  states?: StateData[];
  points?: PointCard[];
  members?: Member[];
  setting?: Partial<ScenarioSetting>;
}

export const BASE_ACTIONS: CardData[] = [
  { id: "s0000", type: "notification", name: "通知", roles: ["all"], hidden: true },
  { id: "talk", type: "talk", name: "相談", roles: ["all"] },
];

export function makeScenario(parts: ScenarioParts = {}): Scenario {
  const replies = parts.replies ?? [];
  return {
    name: "_default_",
    dir: "/nonexistent",
    setting: { teams: [{ id: TEAM, name: "Team 1" }], phases: [{ phase: 1, timelimit: 1200 }], ...parts.setting },
    actions: [...(parts.actions ?? []), ...BASE_ACTIONS],
    members: new Map((parts.members ?? MEMBERS).map((m) => [m.email, m])),
    states: parts.states ?? [],
    replies: new Map([
      [1, replies],
      [-1, replies],
    ]),
    points: parts.points ?? [],
  };
}

export interface Harness {
  clock: FakeClock;
  published: NotificationMessage[];
  inst: WorkflowInstance;
  scenario: Scenario;
}

export function harness(parts: ScenarioParts = {}, start = true): Harness {
  const clock = new FakeClock();
  const published: NotificationMessage[] = [];
  const scenario = makeScenario(parts);
  let seq = 0;
  const inst = new WorkflowInstance(TEAM, 1, {
    scenario: () => scenario,
    clock,
    publish: (m) => published.push(m),
    newId: () => String(++seq),
  });
  if (start) inst.startPhase(1);
  return { clock, published, inst, scenario };
}

export function pub(m: Member) {
  const { passwd: _p, ...rest } = m;
  return rest;
}

export function find(scenario: Scenario, role: string): Member {
  const m = [...scenario.members.values()].find((x) => x.role === role);
  if (!m) throw new Error(`no member ${role}`);
  return m;
}
