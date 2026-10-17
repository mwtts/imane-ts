import { specialMember, type PublicMember } from "@imane/shared";
import type { Member, Scenario } from "./loader";

/** パスワードハッシュを除いたメンバ情報 */
export function toPublicMember(m: PublicMember & { passwd?: string }): PublicMember {
  const { passwd: _omit, ...rest } = m;
  return rest;
}

/** チームのメンバ。order が設定されていれば order 順、なければ rolename 順 */
export function teamMembers(scenario: Scenario, team: string): Member[] {
  return [...scenario.members.values()]
    .filter((m) => m.team === team)
    .sort((a, b) => {
      const oa = a.order ?? 0;
      const ob = b.order ?? 0;
      if (oa !== 0 || ob !== 0) return oa - ob;
      return a.rolename.localeCompare(b.rolename, "ja");
    });
}

/** ロールからメンバを解決する。特殊ロール(system/all/systemall)を含む。大文字小文字は区別しない */
export function memberByRole(scenario: Scenario, team: string, role: string | undefined): PublicMember | undefined {
  if (role === undefined) return undefined;
  const special = specialMember(role);
  if (special) return special;
  const lower = role.toLowerCase();
  const m = teamMembers(scenario, team).find((x) => x.role.toLowerCase() === lower);
  return m ? toPublicMember(m) : undefined;
}

export function memberByEmail(scenario: Scenario, email: string): Member | undefined {
  return scenario.members.get(email);
}
