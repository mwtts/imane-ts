import { isBroadcastRole, type MemberWithPresence, type NotificationMessage, type ServerPush } from "@imane/shared";
import { createLogger } from "./logger";
import { memberByEmail, teamMembers, toPublicMember } from "./scenario/members";
import type { ScenarioStore } from "./scenario/store";

export interface PushSocket {
  send(data: string): void;
}

const log = createLogger("notifier");

/** ログイン中ユーザへのイベント通知(WebSocket) */
export class Notifier {
  /** email -> 接続(複数タブを許容) */
  private sockets = new Map<string, Set<PushSocket>>();

  constructor(
    private readonly scenarios: ScenarioStore,
    /** チームのメンバが所有するステート */
    private readonly ownedStates: (team: string, email: string) => string[],
    private readonly now: () => number = Date.now,
  ) {}

  connect(email: string, socket: PushSocket): void {
    const set = this.sockets.get(email) ?? new Set();
    set.add(socket);
    this.sockets.set(email, set);
    this.pushPresenceFor(email);
  }

  disconnect(email: string, socket: PushSocket): void {
    const set = this.sockets.get(email);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.sockets.delete(email);
    this.pushPresenceFor(email);
  }

  isOnline(email: string): boolean {
    return (this.sockets.get(email)?.size ?? 0) > 0;
  }

  private send(email: string, push: ServerPush): void {
    const body = JSON.stringify(push);
    for (const s of this.sockets.get(email) ?? []) {
      try {
        s.send(body);
      } catch (e) {
        log.warn(`通知の送信に失敗しました: ${email}`, e);
      }
    }
  }

  /** イベントを宛先・送信元・Cc に配信する。宛先がチーム全員ならチームの全員に送る */
  publish(msg: NotificationMessage): void {
    const scenario = this.scenarios.current();
    const recipients = new Set<string>();
    if (isBroadcastRole(msg.to.role)) {
      for (const m of teamMembers(scenario, msg.team)) recipients.add(m.email);
    } else {
      recipients.add(msg.to.email);
    }
    recipients.add(msg.from.email);
    for (const c of msg.cc ?? []) recipients.add(c.email);
    recipients.delete("");
    for (const email of recipients) this.send(email, { type: "event", event: msg });
  }

  broadcast(push: ServerPush): void {
    for (const email of this.sockets.keys()) this.send(email, push);
  }

  presence(team: string): MemberWithPresence[] {
    return teamMembers(this.scenarios.current(), team).map((m) => ({
      ...toPublicMember(m),
      online: this.isOnline(m.email),
      availableStates: this.ownedStates(team, m.email),
    }));
  }

  /** 接続状態が変わったユーザのチームに、プレゼンス情報を送る */
  private pushPresenceFor(email: string): void {
    const member = memberByEmail(this.scenarios.current(), email);
    if (!member) return;
    const members = this.presence(member.team).map((m) => ({ ...m, availableStates: [] }));
    const push: ServerPush = { type: "presence", team: member.team, when: this.now(), members };
    for (const m of members) if (this.isOnline(m.email)) this.send(m.email, push);
  }
}
