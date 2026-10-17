import type { HelpInfo } from "@imane/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { errorText, useApp } from "../context";
import { Modal, Tabs } from "./ui";

const matches = (q: string, ...fields: string[]) => q === "" || fields.join(" ").toLowerCase().includes(q);

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { notify } = useApp();
  const [help, setHelp] = useState<HelpInfo | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.help().then(setHelp, (e) => notify(errorText(e), "error"));
  }, [notify]);

  const q = filter.trim().toLowerCase();
  const multiline = (s: string) => s.split(/\r?\n/).map((line, i) => <div key={i}>{line}</div>);

  return (
    <Modal title="アクションと役割" onClose={onClose} size="wide">
      <input
        type="search"
        className="searchbox"
        placeholder="絞り込み"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="ヘルプを絞り込む"
      />
      {help && (
        <Tabs
          tabs={[
            {
              id: "actions",
              label: "アクション",
              content: () => (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>名前</th>
                      <th>説明</th>
                      <th>所有者</th>
                      <th>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {help.actions
                      .filter((a) => matches(q, a.name, a.description, ...a.holders))
                      .map((a) => (
                        <tr key={a.id}>
                          <td>{a.name}</td>
                          <td>{multiline(a.description)}</td>
                          <td>{a.holders.join(", ")}</td>
                          <td className="muted">{a.id}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ),
            },
            {
              id: "roles",
              label: "ロール",
              content: () => (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>名前</th>
                      <th>説明</th>
                      <th>自動応答</th>
                    </tr>
                  </thead>
                  <tbody>
                    {help.roles
                      .filter((r) => matches(q, r.rolename, r.desc))
                      .map((r) => (
                        <tr key={r.role} className={r.system ? "system-role" : ""}>
                          <td>{r.rolename}</td>
                          <td>{multiline(r.desc)}</td>
                          <td>{r.system ? "はい" : "いいえ"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
}
