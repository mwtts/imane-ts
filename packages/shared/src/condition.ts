/**
 * ステート条件(statecondition / systemstatecondition)の評価。
 *
 * 2つの書式を受け付ける。
 * - 配列形式: ["NAND", "1001", "1002"]  演算子は高々1つ。省略時は呼び出し側の既定演算子。
 * - 式形式:   ["AND(NOT(1001),1002,OR(1003,1004))"]  入れ子可。演算子は大文字小文字を区別しない。
 * 配列の要素のうち "(" を含むものは式として、それ以外はステートIDとして扱う。
 *
 * 演算子の意味:
 *   AND: すべて真 / OR: いずれか真 / NOT・NOR: すべて偽 / NAND: いずれか偽
 */

export const OPERATORS = ["AND", "NAND", "OR", "NOR", "NOT"] as const;
export type Operator = (typeof OPERATORS)[number];

export class ConditionSyntaxError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(`${message}: ${source}`);
    this.name = "ConditionSyntaxError";
  }
}

export type ConditionExpr = { kind: "state"; id: string } | { kind: "op"; op: Operator; args: ConditionExpr[] };

function isOperator(token: string): token is Operator {
  return (OPERATORS as readonly string[]).includes(token);
}

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re = /\s*([(),]|[^(),\s]+)/y;
  let consumed = 0;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    if (m[1] !== undefined) tokens.push(m[1]);
    consumed = re.lastIndex;
  }
  if (src.slice(consumed).trim().length !== 0) {
    throw new ConditionSyntaxError("解析できない文字があります", src);
  }
  return tokens;
}

/** 式形式の条件文字列を構文木に変換する。 */
export function parseConditionExpression(src: string): ConditionExpr {
  const tokens = tokenize(src);
  let pos = 0;

  const parseExpr = (): ConditionExpr => {
    const token = tokens[pos++];
    if (token === undefined || token === "(" || token === ")" || token === ",") {
      throw new ConditionSyntaxError("ステートIDまたは演算子が必要です", src);
    }
    if (tokens[pos] !== "(") return { kind: "state", id: token };

    const op = token.toUpperCase();
    if (!isOperator(op)) throw new ConditionSyntaxError(`不明な演算子 ${token}`, src);
    pos++; // "("
    const args: ConditionExpr[] = [];
    if (tokens[pos] === ")") {
      pos++;
      return { kind: "op", op, args };
    }
    for (;;) {
      args.push(parseExpr());
      const sep = tokens[pos++];
      if (sep === ")") break;
      if (sep !== ",") throw new ConditionSyntaxError("',' または ')' が必要です", src);
    }
    return { kind: "op", op, args };
  };

  const expr = parseExpr();
  if (pos !== tokens.length) throw new ConditionSyntaxError("式の後に余分な文字があります", src);
  return expr;
}

function combine(op: Operator, values: boolean[]): boolean {
  switch (op) {
    case "AND":
      return values.every(Boolean);
    case "OR":
      return values.some(Boolean);
    case "NOT":
    case "NOR":
      return values.every((v) => !v);
    case "NAND":
      return values.some((v) => !v);
  }
}

export function evaluateExpression(expr: ConditionExpr, has: (stateId: string) => boolean): boolean {
  if (expr.kind === "state") return has(expr.id);
  return combine(
    expr.op,
    expr.args.map((a) => evaluateExpression(a, has)),
  );
}

/**
 * ステート条件を評価する。
 * 条件が空(未指定・空配列)なら true を返す。
 * @throws ConditionSyntaxError 書式が不正な場合
 */
export function evaluateCondition(
  cond: readonly string[] | undefined | null,
  defaultOperator: Operator,
  has: (stateId: string) => boolean,
): boolean {
  if (!cond || cond.length === 0) return true;

  let operator: Operator | undefined;
  const values: boolean[] = [];
  for (const raw of cond) {
    const item = String(raw).trim();
    if (item.length === 0) continue;
    if (item.includes("(")) {
      values.push(evaluateExpression(parseConditionExpression(item), has));
    } else if (isOperator(item)) {
      if (operator) throw new ConditionSyntaxError("演算子を複数回使用することはできません", cond.join(","));
      operator = item;
    } else {
      values.push(has(item));
    }
  }
  // 演算子だけ、または空文字だけの条件は「条件なし」とみなす
  if (values.length === 0) return true;
  return combine(operator ?? defaultOperator, values);
}

/** 条件に現れるステートIDを列挙する(画面表示用)。 */
export function collectConditionStates(cond: readonly string[] | undefined | null): string[] {
  if (!cond) return [];
  const ids = new Set<string>();
  const walk = (e: ConditionExpr) => {
    if (e.kind === "state") ids.add(e.id);
    else e.args.forEach(walk);
  };
  for (const raw of cond) {
    const item = String(raw).trim();
    if (item.length === 0 || isOperator(item)) continue;
    if (item.includes("(")) {
      try {
        walk(parseConditionExpression(item));
      } catch {
        // 表示用なので不正な式は無視する
      }
    } else {
      ids.add(item);
    }
  }
  return [...ids];
}
