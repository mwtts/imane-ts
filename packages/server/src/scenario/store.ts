import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import type { ScenarioInfo, ScenarioSetting, ValidationResult } from "@imane/shared";
import { badRequest, HttpError, notFound } from "../errors";
import { createLogger } from "../logger";
import {
  loadActions,
  loadMembers,
  loadPoints,
  loadReplies,
  loadScenario,
  loadSetting,
  loadStates,
  SCENARIO_FILES,
  type Scenario,
} from "./loader";
import { decodeText, parseLenientJson } from "./text";

export const DEFAULT_SCENARIO = "_default_";

const ALLOWED_FILES = new Set<string>(Object.values(SCENARIO_FILES));
/** 1ファイルあたりの上限(展開後) */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const NAME_RE = /^[\p{L}\p{N}_\-.]+$/u;

const log = createLogger("scenario");

export class ScenarioStore {
  private active = DEFAULT_SCENARIO;
  private cache?: { name: string; signature: string; scenario: Scenario };

  constructor(
    readonly baseDir: string,
    readonly sysDir: string,
  ) {
    if (!existsSync(baseDir)) throw new Error(`シナリオデータの配備先が存在しません: ${baseDir}`);
  }

  get activeName(): string {
    return this.active;
  }

  /** シナリオセット名を検証して格納先ディレクトリを返す */
  dirOf(name: string): string {
    if (name === DEFAULT_SCENARIO || name === "") return this.baseDir;
    if (!NAME_RE.test(name) || name === "." || name === ".." || name.startsWith(".")) {
      throw badRequest(`シナリオセット名が不正です: ${name}`);
    }
    return join(this.baseDir, name);
  }

  private signature(dir: string): string {
    const parts: string[] = [];
    for (const d of [this.sysDir, dir]) {
      for (const f of ALLOWED_FILES) {
        try {
          parts.push(String(statSync(join(d, f)).mtimeMs));
        } catch {
          parts.push("-");
        }
      }
    }
    return parts.join(",");
  }

  /** アクティブなシナリオ。ファイルが更新されていれば読み直す */
  current(): Scenario {
    const dir = this.dirOf(this.active);
    const signature = this.signature(dir);
    if (this.cache && this.cache.name === this.active && this.cache.signature === signature) {
      return this.cache.scenario;
    }
    const scenario = loadScenario(this.active, dir, this.sysDir);
    this.cache = { name: this.active, signature, scenario };
    log.info(`シナリオデータを読み込みました: ${this.active} (${dir})`);
    return scenario;
  }

  /** シナリオセットを有効化する。読み込めなければ例外 */
  activate(name: string): Scenario {
    const dir = this.dirOf(name);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw notFound(`シナリオセットが見つかりません: ${name}`);
    const scenario = loadScenario(name || DEFAULT_SCENARIO, dir, this.sysDir);
    this.active = name || DEFAULT_SCENARIO;
    this.cache = { name: this.active, signature: this.signature(dir), scenario };
    log.info(`シナリオセットを変更しました: ${this.active}`);
    return scenario;
  }

  private names(): string[] {
    const subdirs = readdirSync(this.baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && NAME_RE.test(e.name))
      .filter((e) => existsSync(join(this.baseDir, e.name, SCENARIO_FILES.setting)))
      .map((e) => e.name)
      .sort();
    return [DEFAULT_SCENARIO, ...subdirs];
  }

  list(): ScenarioInfo[] {
    return this.names().map((name) => {
      const dir = this.dirOf(name);
      let setting: ScenarioSetting | undefined;
      let error: string | undefined;
      try {
        setting = loadSetting(dir);
      } catch (e) {
        error = (e as Error).message;
      }
      return { name, active: name === this.active, setting, validation: this.validateDir(dir), error };
    });
  }

  validate(name: string): ValidationResult[] {
    const dir = this.dirOf(name);
    if (!existsSync(dir)) throw notFound(`シナリオセットが見つかりません: ${name}`);
    return this.validateDir(dir);
  }

  private validateDir(dir: string): ValidationResult[] {
    const sys = this.sysDir;
    const checks: Array<[string, () => Record<string, number>]> = [
      ["フェーズ", () => ({ count: loadSetting(dir).phases.length, teams: loadSetting(dir).teams.length })],
      ["メンバ", () => ({ count: loadMembers(dir, sys).size })],
      [
        "アクション",
        () => {
          const actions = loadActions(dir, sys);
          return {
            count: actions.length,
            actions: actions.filter((a) => a.type === "action").length,
            autoaction: actions.filter((a) => a.type === "auto").length,
          };
        },
      ],
      ["リプライ", () => ({ count: loadReplies(dir, sys).get(-1)?.length ?? 0 })],
      ["ステート", () => ({ count: loadStates(dir, sys).length })],
      ["ポイント", () => ({ count: loadPoints(dir, sys).length })],
    ];
    return checks.map(([label, run]) => {
      try {
        return { label, valid: true, params: run() };
      } catch (e) {
        return { label, valid: false, error: (e as Error).message };
      }
    });
  }

  exportZip(name: string): Uint8Array {
    const dir = this.dirOf(name);
    if (!existsSync(dir)) throw notFound(`シナリオセットが見つかりません: ${name}`);
    const files: Record<string, Uint8Array> = {};
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json") && statSync(join(dir, f)).isFile()) files[f] = readFileSync(join(dir, f));
    }
    if (Object.keys(files).length === 0) throw notFound("シナリオセットにファイルがありません。");
    return zipSync(files);
  }

  /**
   * zip アーカイブからシナリオセットを登録する。
   * 一時ディレクトリに展開して検証し、すべて正常な場合だけ配置する。
   */
  importZip(rawName: string, data: Uint8Array): { installed: boolean; validation: ValidationResult[] } {
    const name = rawName.replace(/\.zip$/i, "");
    if (name === DEFAULT_SCENARIO) throw badRequest("既定のシナリオセットはzipで置き換えられません。");
    const target = this.dirOf(name);

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(data, {
        filter: (f) => {
          if (f.originalSize > MAX_FILE_BYTES) throw badRequest(`ファイルが大きすぎます: ${f.name}`);
          return ALLOWED_FILES.has(basename(f.name));
        },
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw badRequest("zipアーカイブを展開できません。", e);
    }

    const files = new Map<string, Uint8Array>();
    for (const [path, content] of Object.entries(entries)) {
      const file = basename(path);
      if (files.has(file)) throw badRequest(`同じ名前のファイルが複数含まれています: ${file}`);
      files.set(file, content);
    }
    if (!files.has(SCENARIO_FILES.setting)) throw badRequest("setting.json が含まれていません。");

    const staging = join(this.baseDir, `.upload-${crypto.randomUUID()}`);
    mkdirSync(staging);
    try {
      for (const [file, content] of files) writeFileSync(join(staging, file), content);
      const validation = this.validateDir(staging);
      if (validation.some((v) => !v.valid)) return { installed: false, validation };

      const backup = existsSync(target) ? `${staging}.old` : undefined;
      if (backup) renameSync(target, backup);
      renameSync(staging, target);
      if (backup) rmSync(backup, { recursive: true, force: true });
      log.info(`シナリオセットを登録しました: ${name}`);
      return { installed: true, validation: this.validateDir(target) };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** シナリオファイルを1つ置き換える。JSONとして解析できない内容は拒否する */
  putFile(name: string, filename: string, data: Uint8Array): ValidationResult[] {
    if (!ALLOWED_FILES.has(filename)) throw badRequest(`アップロードできないファイル名です: ${filename}`);
    const dir = this.dirOf(name);
    if (!existsSync(dir)) throw notFound(`シナリオセットが見つかりません: ${name}`);
    if (data.byteLength > MAX_FILE_BYTES) throw badRequest("ファイルが大きすぎます。");
    try {
      parseLenientJson(decodeText(data), filename);
    } catch (e) {
      throw badRequest((e as Error).message, e);
    }

    // 置き換えた状態を一時ディレクトリで検証し、正常な場合だけ書き込む
    const staging = join(this.baseDir, `.upload-${crypto.randomUUID()}`);
    mkdirSync(staging);
    try {
      for (const f of ALLOWED_FILES) {
        if (f !== filename && existsSync(join(dir, f))) writeFileSync(join(staging, f), readFileSync(join(dir, f)));
      }
      writeFileSync(join(staging, filename), data);
      const validation = this.validateDir(staging);
      const failed = validation.filter((v) => !v.valid);
      if (failed.length > 0) {
        throw badRequest(`シナリオデータにエラーがあるため保存しませんでした。${failed.map((v) => `${v.label}: ${v.error}`).join(" / ")}`);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    writeFileSync(join(dir, filename), data);
    log.info(`シナリオデータを保存しました: ${name}/${filename}`);
    return this.validateDir(dir);
  }
}
