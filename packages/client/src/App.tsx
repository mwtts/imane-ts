import { useEffect, useMemo, useState } from "react";
import type { LoginOptions, ProductInfo } from "@imane/shared";
import { api, connectEvents, hasToken } from "./api";
import { AppProvider, errorText, useApp } from "./context";
import { pushBus } from "./push";
import { FacilitatorView } from "./views/Facilitator";
import { ParticipantView } from "./views/Participant";
import { ReviewView } from "./views/Review";

type View = "console" | "review" | "facilitator";

const CLIENT_VERSION = "v2.0.0";

function LoginPanel({ options }: { options: LoginOptions | null }) {
  const { setSession, notify } = useApp();
  const preferAdmin = useMemo(() => new URLSearchParams(location.search).has("isadmin"), []);
  const [team, setTeam] = useState("");
  const [userid, setUserid] = useState("");
  const [manual, setManual] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (options && !team) setTeam(options.teams[0]?.id ?? "");
  }, [options, team]);

  const members = useMemo(() => (options?.members ?? []).filter((m) => m.team === team), [options, team]);
  useEffect(() => {
    const preferred = (preferAdmin && members.find((m) => m.isadmin)) || members.find((m) => !m.isadmin) || members[0];
    setUserid(preferred?.email ?? "");
  }, [members, preferAdmin]);

  const login = async () => {
    if (!userid) {
      notify("ユーザを選択してください。", "warn");
      return;
    }
    setBusy(true);
    try {
      setSession(await api.login(userid, password));
    } catch (e) {
      notify(`ログオンに失敗しました。${errorText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="login-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void login();
      }}
    >
      <label>
        チーム:{" "}
        <select value={team} onChange={(e) => setTeam(e.target.value)}>
          {options?.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {manual ? (
        <input type="text" value={userid} onChange={(e) => setUserid(e.target.value)} placeholder="ユーザID" aria-label="ユーザID" size={28} />
      ) : (
        <label>
          役割:{" "}
          <select value={userid} onChange={(e) => setUserid(e.target.value)}>
            {members.map((m) => (
              <option key={m.email} value={m.email} title={m.email}>
                {m.rolename}
                {m.isadmin ? "（ファシリテータ）" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="icon-button" title="ユーザIDの直接入力を切り替えます。" onClick={() => setManual((v) => !v)}>
        <span className="fa fa-pencil-square-o" />
      </button>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="パスワード(設定時のみ)" aria-label="パスワード" size={18} />
      <button type="submit" className="primary" disabled={busy}>
        <span className="fa fa-sign-in" /> ログイン
      </button>
    </form>
  );
}

function Shell() {
  const { session, setSession, setStates, toasts, dismiss, notify } = useApp();
  const [product, setProduct] = useState<ProductInfo>({});
  const [options, setOptions] = useState<LoginOptions | null>(null);
  const [view, setView] = useState<View>("console");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    api.product().then(setProduct, () => {});
    api.loginOptions().then(setOptions, (e) => notify(`シナリオデータを読み込めません。${errorText(e)}`, "error"));
    if (hasToken()) api.session().then(setSession, () => {});
  }, [notify, setSession]);

  useEffect(() => {
    document.title = [product.CAPTION || "IMANE", session ? `${session.rolename}(${session.userid})` : ""].filter(Boolean).join(" -- ");
  }, [product, session]);

  // ログインしたら定義を読み込み、プッシュ通知に接続する。切断されたら再接続する
  useEffect(() => {
    if (!session) return;
    setView(session.isadmin ? "facilitator" : "console");
    api.states().then(setStates, (e) => notify(errorText(e), "error"));

    let stop = () => {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      stop = connectEvents(
        (p) => {
          setConnected(true);
          if (p.type === "alert") notify(p.message, "warn");
          pushBus.emit(p);
        },
        () => {
          setConnected(false);
          notify("サーバとの接続が解除されました。再接続します。", "warn");
          retry = setTimeout(open, 5000);
        },
      );
    };
    open();
    return () => {
      clearTimeout(retry);
      stop();
      setConnected(false);
    };
  }, [session, setStates, notify]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // セションが既に無効でもログアウト扱いにする
    }
    setSession(null);
  };

  const nav: Array<[View, string, string]> = [
    ["console", "演習コンソール", "fa-comments"],
    ["review", "振り返り", "fa-line-chart"],
    ...(session?.isadmin ? ([["facilitator", "ファシリテータ用コンソール", "fa-sliders"]] as Array<[View, string, string]>) : []),
  ];

  return (
    <>
      <div className="product-info">
        {product.SERVER_DESC} {product.SERVER_VERSION} / client {CLIENT_VERSION} {product.COPYRIGHT}
      </div>
      <header className="app-header">
        <h1>{product.CAPTION || "IMANE"}</h1>
        {session ? (
          <div className="login-info">
            <span className={`fa ${connected ? "fa-plug online" : "fa-chain-broken offline"}`} title={connected ? "接続中" : "未接続"} />
            <strong>{session.rolename}</strong> <span className="muted">({session.userid})</span>
            <button type="button" onClick={() => void logout()}>
              <span className="fa fa-sign-out" /> ログアウト
            </button>
          </div>
        ) : (
          <LoginPanel options={options} />
        )}
        {session && (
          <nav className="app-nav">
            {nav.map(([id, label, icon]) => (
              <button key={id} type="button" className={view === id ? "active" : ""} onClick={() => setView(id)}>
                <span className={`fa ${icon}`} /> {label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main>
        {!session && <div className="welcome">演習に参加するには、チームと役割を選んでログインしてください。</div>}
        {session && view === "console" && <ParticipantView />}
        {session && view === "review" && <ReviewView />}
        {session?.isadmin && view === "facilitator" && <FacilitatorView />}
      </main>

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`}>
            <span className="toast-text">{t.text}</span>
            <button type="button" className="icon-button" onClick={() => dismiss(t.id)} aria-label="閉じる">
              <span className="fa fa-times" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
