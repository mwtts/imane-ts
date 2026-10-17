/** ページから SharedWorker への要求 */
export type ToWorker =
  | {
      type: "fetch";
      id: number;
      method: string;
      url: string;
      headers: [string, string][];
      body?: ArrayBuffer;
    }
  | { type: "connect"; id: number; token: string }
  | { type: "disconnect"; id: number }
  /** タブを閉じるときに、そのタブの接続をすべて切る */
  | { type: "release" };

/** SharedWorker からページへの応答・通知 */
export type FromWorker =
  | {
      type: "response";
      id: number;
      status: number;
      statusText: string;
      headers: [string, string][];
      body: ArrayBuffer;
    }
  | { type: "push"; id: number; data: string }
  | { type: "closed"; id: number };
