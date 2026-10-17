import { type PublicMember, ROLE_EVERYONE, ROLE_SYSTEM, ROLE_TEAM } from "./types";

const ALWAYS_SYSTEM = [true, true, true, true];

/** システム(自動応答) */
export const MEMBER_SYSTEM: PublicMember = Object.freeze({
  email: "",
  name: "システム",
  rolename: "システム",
  desc: "システム",
  role: ROLE_SYSTEM,
  system: ALWAYS_SYSTEM,
});

/** チーム全員 */
export const MEMBER_TEAM: PublicMember = Object.freeze({
  email: "",
  name: "チーム全員",
  rolename: "チーム全員",
  desc: "チーム全員",
  role: ROLE_TEAM,
  system: ALWAYS_SYSTEM,
});

/** 全員 */
export const MEMBER_EVERYONE: PublicMember = Object.freeze({
  email: "",
  name: "全員",
  rolename: "全員",
  desc: "全員",
  role: ROLE_EVERYONE,
  system: ALWAYS_SYSTEM,
});

export function isBroadcastRole(role: string | undefined): boolean {
  return role === ROLE_TEAM || role === ROLE_EVERYONE;
}

/** 特殊ロール(system/all/systemall)ならその Member を返す */
export function specialMember(role: string | undefined): PublicMember | undefined {
  switch (role?.toLowerCase()) {
    case ROLE_SYSTEM:
      return MEMBER_SYSTEM;
    case ROLE_TEAM:
      return MEMBER_TEAM;
    case ROLE_EVERYONE:
      return MEMBER_EVERYONE;
    default:
      return undefined;
  }
}

/**
 * 指定フェーズで自動応答ユーザかどうか。
 * system[phase-1] を参照し、範囲外なら system[0] を使う。
 */
export function isSystemUser(member: Pick<PublicMember, "system">, phase: number): boolean {
  const flags = member.system;
  if (!flags || flags.length === 0) return false;
  if (phase >= 1 && phase <= flags.length) return flags[phase - 1] === true;
  return flags[0] === true;
}

/**
 * ロール指定がメンバにマッチするか。
 * メンバまたはロールが「チーム全員/全員」なら常にマッチ、ロール未指定もマッチ。
 */
export function memberMatchesRole(member: Pick<PublicMember, "role">, role: string | undefined): boolean {
  if (isBroadcastRole(member.role)) return true;
  if (role === undefined || isBroadcastRole(role)) return true;
  return member.role === role;
}
