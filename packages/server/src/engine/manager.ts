import type { NotificationMessage, ProcessSummary } from "@imane/shared";
import { badRequest, notFound } from "../errors";
import { createLogger } from "../logger";
import type { ScenarioStore } from "../scenario/store";
import { WorkflowInstance, type Clock, type WorkflowSnapshot } from "./workflow";

const log = createLogger("manager");

export interface ManagerDeps {
  scenarios: ScenarioStore;
  clock: Clock;
  publish: (msg: NotificationMessage) => void;
}

/** シナリオに定義されたチームごとにワークフローインスタンスを保持する */
export class WorkflowManager {
  private instances = new Map<string, WorkflowInstance>();
  private nextPid: number;
  private ticker?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: ManagerDeps) {
    this.nextPid = deps.clock.now();
    this.initialize();
  }

  private create(team: string): WorkflowInstance {
    return new WorkflowInstance(team, ++this.nextPid, {
      scenario: () => this.deps.scenarios.current(),
      clock: this.deps.clock,
      publish: this.deps.publish,
    });
  }

  /** アクティブなシナリオのチーム定義に従ってインスタンスを作り直す */
  initialize(): void {
    this.instances = new Map();
    for (const team of this.deps.scenarios.current().setting.teams) {
      const inst = this.create(team.id);
      this.instances.set(team.id, inst);
      log.info(`ワークフロープロセスを生成しました。チーム:${team.id} id:${inst.pid}`);
    }
  }

  all(): WorkflowInstance[] {
    return [...this.instances.values()];
  }

  find(team: string): WorkflowInstance | undefined {
    return this.instances.get(team);
  }

  get(team: string): WorkflowInstance {
    const inst = this.instances.get(team);
    if (!inst) throw notFound(`チームが見つかりません: ${team}`);
    return inst;
  }

  processes(): ProcessSummary[] {
    const scenario = this.deps.scenarios.current();
    return scenario.setting.teams
      .map((t) => {
        const inst = this.instances.get(t.id);
        return inst
          ? { pid: inst.pid, team: t.id, teamName: t.name, scenario: scenario.name, workflow: inst.summary() }
          : undefined;
      })
      .filter((p) => p !== undefined);
  }

  /** フェーズを開始する。force なら状態を破棄して作り直す */
  start(team: string, phase: number, force = false): WorkflowInstance {
    const setting = this.deps.scenarios.current().setting;
    if (!setting.phases.some((p) => p.phase === phase)) throw badRequest(`フェーズ${phase}は定義されていません。`);
    let inst = this.get(team);
    if (force) {
      inst = this.create(team);
      this.instances.set(team, inst);
    }
    inst.startPhase(phase);
    return inst;
  }

  /** シナリオセットの変更: すべて中断してから作り直す */
  switchScenario(name: string): void {
    for (const inst of this.instances.values()) if (inst.isRunning()) inst.abort();
    this.deps.scenarios.activate(name);
    this.initialize();
  }

  snapshots(team?: string): WorkflowSnapshot[] {
    return (team ? [this.get(team)] : this.all()).map((i) => i.snapshot());
  }

  /** 保存したデータから復元する。復元したチームは一時停止状態になる */
  restore(snapshots: WorkflowSnapshot[]): void {
    const restored = snapshots.map((s) => {
      const current = this.get(s?.team);
      return WorkflowInstance.restore(s, current.pid, {
        scenario: () => this.deps.scenarios.current(),
        clock: this.deps.clock,
        publish: this.deps.publish,
      });
    });
    for (const inst of restored) {
      this.instances.set(inst.team, inst);
      log.info(`ワークフローを復元しました: ${inst.team}`);
    }
  }

  tickAll(): void {
    for (const inst of this.instances.values()) inst.tick();
  }

  startTicker(intervalMs = 1000): void {
    this.stopTicker();
    this.ticker = setInterval(() => this.tickAll(), intervalMs);
  }

  stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }
}
