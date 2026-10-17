import { describe, expect, test } from "bun:test";
import { collectConditionStates, ConditionSyntaxError, evaluateCondition, parseConditionExpression } from "@imane/shared";

const holding = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};

describe("配列形式の条件", () => {
  test("空の条件は真", () => {
    expect(evaluateCondition(undefined, "OR", holding())).toBe(true);
    expect(evaluateCondition([], "AND", holding())).toBe(true);
    expect(evaluateCondition([""], "OR", holding())).toBe(true);
  });

  test("既定演算子が使われる", () => {
    expect(evaluateCondition(["1", "2"], "OR", holding("2"))).toBe(true);
    expect(evaluateCondition(["1", "2"], "AND", holding("2"))).toBe(false);
  });

  test("明示した演算子が既定より優先される", () => {
    expect(evaluateCondition(["AND", "1", "2"], "OR", holding("1"))).toBe(false);
    expect(evaluateCondition(["NAND", "1", "2"], "OR", holding("1"))).toBe(true);
    expect(evaluateCondition(["NOR", "1", "2"], "OR", holding())).toBe(true);
    expect(evaluateCondition(["NOT", "1"], "OR", holding("1"))).toBe(false);
  });

  test("演算子の重複はエラー", () => {
    expect(() => evaluateCondition(["AND", "OR", "1"], "OR", holding())).toThrow(ConditionSyntaxError);
  });
});

describe("式形式の条件", () => {
  test("サンプルシナリオの演習終了条件", () => {
    const cond = ["AND(NOT(10020005),10030009,10040011,10020006)"];
    expect(evaluateCondition(cond, "OR", holding("10030009", "10040011", "10020006"))).toBe(true);
    expect(evaluateCondition(cond, "OR", holding("10020005", "10030009", "10040011", "10020006"))).toBe(false);
    expect(evaluateCondition(cond, "OR", holding("10030009", "10020006"))).toBe(false);
  });

  test("NAND の入れ子", () => {
    const cond = ["AND(10020006,NAND(10030009,10040011))"];
    expect(evaluateCondition(cond, "OR", holding("10020006"))).toBe(true);
    expect(evaluateCondition(cond, "OR", holding("10020006", "10030009"))).toBe(true);
    expect(evaluateCondition(cond, "OR", holding("10020006", "10030009", "10040011"))).toBe(false);
  });

  test("演算子は大文字小文字を区別せず空白を許容する", () => {
    expect(evaluateCondition([" or( 1 , and(2,3) ) "], "AND", holding("2", "3"))).toBe(true);
  });

  test("NOT と NOR は全引数が偽のとき真", () => {
    expect(evaluateCondition(["NOT(1,2)"], "OR", holding())).toBe(true);
    expect(evaluateCondition(["NOT(1,2)"], "OR", holding("2"))).toBe(false);
  });

  test("不正な式はエラー", () => {
    expect(() => parseConditionExpression("AND(1,2")).toThrow(ConditionSyntaxError);
    expect(() => parseConditionExpression("XOR(1,2)")).toThrow(ConditionSyntaxError);
    expect(() => parseConditionExpression("AND(1,,2)")).toThrow(ConditionSyntaxError);
    expect(() => parseConditionExpression("AND(1) 2")).toThrow(ConditionSyntaxError);
  });

  test("条件に現れるステートを列挙できる", () => {
    expect(collectConditionStates(["AND(NOT(1),2)", "OR", "3"]).sort()).toEqual(["1", "2", "3"]);
  });
});
