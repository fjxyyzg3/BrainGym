import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { api, ApiError } from "./api";
import { NBackGame, type GameSnapshot } from "./game";
import { generateSequence, score, STEP_MS, TRIALS } from "../shared/rules";
import {
  GAME,
  VERSION,
  type Counts,
  type User,
  type SavedResult,
  type ResultInput,
  type History,
} from "../shared/contracts";

type Page = "home" | "n-back" | "records";
const currentPage = (): Page =>
  location.hash === "#n-back"
    ? "n-back"
    : location.hash === "#records"
      ? "records"
      : "home";
const go = (page: Page) => {
  location.hash = page;
};
const formatScore = (x: number) => x.toFixed(1);
const formatTime = (x: string) =>
  new Date(x).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
function Icon({
  name,
  size = 20,
}: {
  name: "chart" | "arrow" | "user" | "close" | "check" | "clock";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    chart: (
      <>
        <path d="M4 3v17h17M9 15V9m5 6V5m5 10v-4" />
      </>
    ),
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function MiniGrid() {
  return (
    <div className="mini-grid" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={i === 4 ? "on" : ""} />
      ))}
    </div>
  );
}
function Login({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (user: User) => void;
}) {
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    input.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const nodes = [
          input.current,
          document.querySelector<HTMLButtonElement>(".login-submit"),
          closeButton.current,
        ].filter(Boolean) as HTMLElement[];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose, busy]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ user: User }>("login", { token: token.trim() });
      setToken("");
      onLogin(data.user);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        <div className="modal-icon">
          <Icon name="user" size={26} />
        </div>
        <h2 id="login-title">留住每一次练习</h2>
        <p>输入管理员发放的个人 Token，查看并保存你的训练记录。</p>
        <form onSubmit={submit}>
          <label htmlFor="token">个人 Token</label>
          <input
            ref={input}
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="粘贴你的个人 Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            maxLength={256}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary login-submit"
            disabled={busy || !token.trim()}
          >
            {busy ? "正在验证…" : "登录"}
          </button>
        </form>
        <p className="fine">
          登录状态有效期为 7 天。Token 仅用于验证，不在浏览器中持久保存。
        </p>
        <button
          ref={closeButton}
          className="icon-button modal-close"
          onClick={onClose}
          disabled={busy}
          aria-label="关闭登录"
        >
          <Icon name="close" />
        </button>
      </section>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>(currentPage),
    [user, setUser] = useState<User | null>(null),
    [offline, setOffline] = useState(!navigator.onLine),
    [loading, setLoading] = useState(true),
    [login, setLogin] = useState(false),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User }>("me");
      setUser(data.user);
      setOffline(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      if (err instanceof ApiError) setOffline(err.code === "NETWORK_ERROR");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const change = () => setPage(currentPage());
    const focus = () => {
      void refresh();
    };
    window.addEventListener("hashchange", change);
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    const disconnected = () => setOffline(true);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
      window.removeEventListener("offline", disconnected);
    };
  }, [refresh]);
  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) setOffline(err.code === "NETWORK_ERROR");
      if (
        err instanceof ApiError &&
        (err.status === 401 || err.code === "IDENTITY_CONFLICT")
      )
        void refresh();
    },
    [refresh],
  );
  const openLogin = useCallback(() => setLogin(true), []),
    closeLogin = useCallback(() => setLogin(false), []);
  const savedCallback = useCallback(() => setRevision((x) => x + 1), []);
  const abortNotice = useCallback(
    () => setNotice("本局已结束，未计入历史和最佳成绩。"),
    [],
  );
  const logout = async () => {
    try {
      await api("logout", {});
      setUser(null);
      setNotice("已退出登录");
    } catch (err) {
      setNotice((err as Error).message);
    }
  };
  const authenticated = (next: User) => {
    setUser(next);
    setOffline(false);
    setRevision((x) => x + 1);
    setNotice(`欢迎，${next.name}`);
  };
  const verifiedUser = useCallback((next: User | null) => {
    setUser(next);
    setOffline(false);
  }, []);
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#home" aria-label="BrainGym 首页">
            <span className="brand-symbol" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>BrainGym</span>
          </a>
          <nav className="main-nav" aria-label="主导航">
            <a
              href="#home"
              className={page === "home" || page === "n-back" ? "active" : ""}
              aria-current={page === "home" ? "page" : undefined}
            >
              训练大厅
            </a>
            <a
              href="#records"
              className={page === "records" ? "active" : ""}
              aria-current={page === "records" ? "page" : undefined}
            >
              个人记录
            </a>
          </nav>
          <div className="account">
            {user ? (
              <>
                <span className="avatar">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="user-name">{user.name}</span>
                <button className="text-button" onClick={logout}>
                  退出
                </button>
              </>
            ) : (
              <>
                <span className="guest-label">
                  {loading ? "正在连接…" : "游客模式"}
                </span>
                <button className="login-button" onClick={openLogin}>
                  <Icon name="user" size={16} />
                  Token 登录
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="main-content" id="main-content" tabIndex={-1}>
        {offline && (
          <div className="warning" role="status">
            当前无法连接服务器。游客练习不保存成绩，登录和个人记录需要联网。
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="icon-button"
              onClick={() => setNotice("")}
              aria-label="关闭提示"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {page === "home" ? (
          <Home />
        ) : page === "records" ? (
          <Records
            user={user}
            revision={revision}
            onLogin={openLogin}
            onError={onError}
            onUser={verifiedUser}
          />
        ) : (
          <Training
            user={user}
            offline={offline}
            onLogin={openLogin}
            onUser={verifiedUser}
            onError={onError}
            onSaved={savedCallback}
            onAbortNotice={abortNotice}
          />
        )}
      </main>
      {login && <Login onClose={closeLogin} onLogin={authenticated} />}
    </div>
  );
}

function Home() {
  return (
    <>
      <div className="home-heading">
        <h1>训练大厅</h1>
        <p>选一个游戏，开始练习。</p>
      </div>
      <section className="games-grid" aria-label="游戏列表">
        <article className="game-card" aria-labelledby="n-back-title">
          <div className="game-card-icon">
            <MiniGrid />
          </div>
          <h2 id="n-back-title">空间 N-back</h2>
          <p className="game-description">记住位置，判断是否与 N 步前相同。</p>
          <div className="game-meta">
            <span>
              <Icon name="clock" size={16} />约 80 秒
            </span>
            <span>1～5 级难度</span>
          </div>
          <button className="primary card-start" onClick={() => go("n-back")}>
            开始训练
            <Icon name="arrow" size={18} />
          </button>
        </article>
      </section>
    </>
  );
}

interface Outcome {
  counts: Counts;
  n: number;
  owner: User | null;
  payload: ResultInput | null;
  localScore: number;
}
function Training({
  user,
  offline,
  onLogin,
  onUser,
  onError,
  onSaved,
  onAbortNotice,
}: {
  user: User | null;
  offline: boolean;
  onLogin: () => void;
  onUser: (user: User | null) => void;
  onError: (err: unknown) => void;
  onSaved: () => void;
  onAbortNotice: () => void;
}) {
  const [n, setN] = useState(2),
    [mode, setMode] = useState<"idle" | "running" | "result" | "aborted">(
      "idle",
    ),
    [starting, setStarting] = useState(false),
    [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null),
    [outcome, setOutcome] = useState<Outcome | null>(null),
    [saveStatus, setSaveStatus] = useState<
      "saving" | "saved" | "failed" | "guest"
    >("guest");
  const game = useRef<NBackGame | null>(null),
    owner = useRef<User | null>(null),
    alive = useRef(true),
    saving = useRef(false),
    running = useRef(false),
    animation = useRef(0),
    lastSnapshot = useRef(""),
    resultId = useRef("");
  const submit = useCallback(
    async (result: Outcome) => {
      if (!result.payload || saving.current) return;
      saving.current = true;
      setSaveStatus("saving");
      setError("");
      try {
        const saved = await api<SavedResult>("results", result.payload);
        if (alive.current) {
          setOutcome({ ...result, localScore: saved.score });
          setSaveStatus("saved");
          onSaved();
        }
      } catch (err) {
        if (alive.current) {
          setSaveStatus("failed");
          setError((err as Error).message);
          onError(err);
        }
      } finally {
        saving.current = false;
      }
    },
    [onSaved, onError],
  );
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const abort = useCallback(() => {
    if (game.current && running.current) {
      running.current = false;
      game.current.abort();
      cancelAnimationFrame(animation.current);
      if (alive.current) setMode("aborted");
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.hidden) abort();
    };
    const hide = () => abort();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", hide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", hide);
      cancelAnimationFrame(animation.current);
      if (game.current && running.current) {
        running.current = false;
        game.current.abort();
        onAbortNotice();
      }
    };
  }, [abort, onAbortNotice]);
  const respond = useCallback(() => {
    if (game.current?.answer(performance.now()))
      setSnapshot(game.current.tick(performance.now()));
  }, []);
  useEffect(() => {
    if (mode !== "running") return;
    const key = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) respond();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, respond]);
  const start = async (asGuest = false) => {
    setStarting(true);
    setError("");
    try {
      let current: User | null = null;
      if (!asGuest) {
        try {
          current = (await api<{ user: User }>("me")).user;
          onUser(current);
        } catch (err) {
          // An anonymous online guest is valid; a network failure never is
          // permission to silently downgrade an unverified or signed-in user.
          if (!(err instanceof ApiError && err.status === 401 && !user))
            throw err;
          onUser(null);
        }
      }
      if (!alive.current) return;
      owner.current = current;
      resultId.current = crypto.randomUUID();
      game.current = new NBackGame(n, generateSequence(n), performance.now());
      running.current = true;
      lastSnapshot.current = "";
      setOutcome(null);
      setMode("running");
      const frame = () => {
        if (!alive.current || !game.current) return;
        const state = game.current.tick(performance.now());
        const key = JSON.stringify(state);
        if (key !== lastSnapshot.current) {
          setSnapshot(state);
          lastSnapshot.current = key;
        }
        if (state.phase === "finished") {
          running.current = false;
          const counts = game.current.result!;
          const completedAt = new Date().toISOString();
          const result: Outcome = {
            counts,
            n,
            owner: owner.current,
            payload: owner.current
              ? {
                  ...counts,
                  resultId: resultId.current,
                  startedByUserId: owner.current.id,
                  game: GAME,
                  version: VERSION,
                  n,
                  completedAt,
                }
              : null,
            localScore: score(counts),
          };
          setOutcome(result);
          setMode("result");
          setSaveStatus(result.payload ? "saving" : "guest");
          if (result.payload) void submitRef.current(result);
          return;
        }
        if (state.phase !== "aborted")
          animation.current = requestAnimationFrame(frame);
      };
      frame();
    } catch (err) {
      setError((err as Error).message);
      onError(err);
    } finally {
      setStarting(false);
    }
  };
  // Result ownership stays on the mounted training page, independently of current login.
  if (mode === "result" && outcome)
    return (
      <section className="result-page">
        <div className="result-heading">
          <span className="result-check">
            <Icon name="check" size={30} />
          </span>
          <div className="eyebrow">SESSION COMPLETE</div>
          <h1>练习完成，做得不错。</h1>
          <p>{outcome.n}-back · 30 次有效判断</p>
        </div>
        <div className="result-card">
          <div className="score-caption">平衡准确率</div>
          <div className="big-score" data-testid="score">
            {formatScore(outcome.localScore)}
            <small>/ 100</small>
          </div>
          <p className="muted">匹配命中率与不匹配正确拒绝率各占一半</p>
          <div className="counts-grid">
            {(
              [
                ["tp", "命中"],
                ["fn", "漏报"],
                ["fp", "误报"],
                ["tn", "正确拒绝"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <strong data-testid={key}>{outcome.counts[key]}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div
            className={`save-message ${saveStatus === "failed" ? "save-error" : ""}`}
            role="status"
          >
            {saveStatus === "saving" ? (
              "正在保存本局成绩…"
            ) : saveStatus === "saved" ? (
              <>
                <Icon name="check" size={17} />
                已保存到 {outcome.owner?.name} 的个人记录
              </>
            ) : saveStatus === "guest" ? (
              "游客练习：本局结果仅在此页面展示，不会保存。"
            ) : (
              <>未保存：{error}</>
            )}
          </div>
          {saveStatus === "failed" && (
            <div className="retry-actions">
              <button className="primary" onClick={() => void submit(outcome)}>
                重试保存
              </button>
              <button className="secondary" onClick={onLogin}>
                登录开局账户
              </button>
            </div>
          )}
          {saveStatus === "guest" && (
            <p className="fine">
              <button className="text-link" onClick={onLogin}>
                登录
              </button>
              后开始的新对局才会保存，本局不补传。
            </p>
          )}
          <div className="result-actions">
            <button
              className="primary"
              onClick={() => {
                game.current = null;
                setMode("idle");
                setError("");
              }}
            >
              再练一局
              <Icon name="arrow" size={17} />
            </button>
            <button
              className="secondary"
              onClick={() => go(outcome.owner ? "records" : "home")}
            >
              {outcome.owner ? "查看个人记录" : "返回训练大厅"}
            </button>
          </div>
        </div>
      </section>
    );
  if (mode === "running" && snapshot)
    return (
      <section className="play-page">
        <div className="play-top">
          <span className="tag">空间 {n}-back</span>
          <button className="text-button" onClick={abort}>
            结束本局
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="play-title">
          <span className="eyebrow">
            {snapshot.phase === "warmup"
              ? "先记住起始位置"
              : "保持专注，跟随节奏"}
          </span>
          <h1>
            {snapshot.phase === "warmup"
              ? `记忆准备 ${snapshot.trial} / ${n}`
              : `判断 ${snapshot.trial} / 30`}
          </h1>
          <p>当前位置与 {n} 步前相同，就按下匹配</p>
        </div>
        <div className="board" role="img" aria-label="九宫格位置展示">
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              data-testid={`cell-${i}`}
              className={`cell ${snapshot.lit && snapshot.cell === i ? "lit" : ""}`}
            />
          ))}
        </div>
        <button
          className={`primary match-button ${snapshot.answered ? "marked" : ""}`}
          disabled={snapshot.phase !== "playing" || snapshot.answered}
          onPointerDown={(e) => {
            e.preventDefault();
            respond();
          }}
          onClick={(e) => {
            if (e.detail === 0) respond();
          }}
        >
          {snapshot.answered ? (
            <>
              <Icon name="check" />
              已标记匹配
            </>
          ) : (
            "匹配"
          )}
          <kbd aria-hidden="true">空格</kbd>
        </button>
        <p className="play-hint">不相同，无需操作 · 留空期间也可以作答</p>
        <div className="progress-track">
          <div
            style={{
              width: `${snapshot.phase === "warmup" ? 0 : ((snapshot.trial - 1) / TRIALS) * 100}%`,
            }}
          />
        </div>
        <p className="fine">请保持页面在前台，切后台或锁屏将结束本局。</p>
      </section>
    );
  return (
    <>
      <a className="back-link" href="#home">
        ← 返回训练大厅
      </a>
      <div className="training-title">
        <span className="eyebrow">WORKING MEMORY</span>
        <h1>空间 N-back</h1>
        <p>观察当下的位置，回想 N 步之前。</p>
      </div>
      {mode === "aborted" && (
        <div className="warning" role="status">
          本局已结束，未计入历史和最佳成绩。准备好后，可以重新开始。
        </div>
      )}
      <div className="setup-columns">
        <section className="instructions card">
          <div className="instruction-visual">
            <MiniGrid />
            <span>现在的位置 = N 步前的位置？</span>
          </div>
          <h2>如何练习</h2>
          <ol>
            <li>九宫格中的一个位置会短暂亮起，记住它。</li>
            <li>
              与 <strong>N 步之前</strong>的位置相同，就点击“匹配”或按空格。
            </li>
            <li>不相同则不操作。每一步仅接受一次输入。</li>
          </ol>
          <div className="rule-facts">
            <span>
              <Icon name="clock" size={16} />
              每步 2.5 秒
            </span>
            <span>亮起 0.5 秒</span>
            <span>30 次有效判断</span>
          </div>
          <p className="fine">
            先展示 N 次作为记忆起点，不计分。结果以平衡准确率评定。
          </p>
        </section>
        <section className="settings card">
          <h2>准备好了吗？</h2>
          <p className="muted">选择适合自己的难度</p>
          <label className="field-label">记忆跨度 N</label>
          <div className="level-options" role="group" aria-label="选择 N 值">
            {[1, 2, 3, 4, 5].map((x) => (
              <button
                key={x}
                className={n === x ? "selected" : ""}
                aria-pressed={n === x}
                onClick={() => setN(x)}
              >
                {x}
              </button>
            ))}
          </div>
          <p className="level-description">
            回想 <strong>{n} 步</strong>前的位置 · 约{" "}
            {Math.ceil(((n + TRIALS) * STEP_MS) / 1000)} 秒
          </p>
          <div className="identity-note">
            <Icon name={user ? "check" : "user"} size={19} />
            <p>
              {user ? (
                <>
                  以 <strong>{user.name}</strong> 的身份开始，完整对局会保存。
                </>
              ) : (
                <>当前为游客，能查看结果，但不会保存。</>
              )}
            </p>
          </div>
          {offline && (
            <div className="offline-choice">
              <p className="warning-text">
                无法联网验证身份。选择游客练习后，本局不保存，恢复联网也不会补传。
              </p>
              <button
                className="secondary"
                disabled={starting}
                onClick={() => void start(true)}
              >
                以游客身份练习
              </button>
            </div>
          )}
          <p className="warning-text">切后台、锁屏或中途退出，本局作废。</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary start-session"
            onClick={() => void start()}
            disabled={starting}
          >
            {starting ? "正在准备…" : "开始本局"}
            <Icon name="arrow" size={18} />
          </button>
          {!user && (
            <button className="text-link login-first" onClick={onLogin}>
              先登录，记录我的成绩
            </button>
          )}
        </section>
      </div>
    </>
  );
}

function Records({
  user,
  revision,
  onLogin,
  onError,
  onUser,
}: {
  user: User | null;
  revision: number;
  onLogin: () => void;
  onError: (err: unknown) => void;
  onUser: (user: User) => void;
}) {
  const [history, setHistory] = useState<History | null>(null),
    [bests, setBests] = useState<SavedResult[]>([]),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setPage(1);
    setHistory(null);
    setBests([]);
  }, [user?.id]);
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setBests([]);
    setError("");
    if (!user) return;
    setBusy(true);
    void (async () => {
      try {
        const [h, b] = await Promise.all([
          api<History & { user: User }>(`history?page=${page}`),
          api<{ items: SavedResult[]; user: User }>("bests"),
        ]);
        if (cancelled) return;
        if (h.user.id !== user.id || b.user.id !== user.id) {
          onUser(h.user);
          throw new Error("账户发生变化，请重新查看记录");
        }
        setHistory(h);
        setBests(b.items);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          onError(err);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, page, revision, refresh, onError, onUser]);
  return (
    <>
      <div className="records-title">
        <div>
          <span className="eyebrow">YOUR PRACTICE, YOUR PROGRESS</span>
          <h1>个人记录</h1>
          <p>每一局，都是专注留下的痕迹。</p>
        </div>
        {user && (
          <button className="secondary compact" onClick={() => go("n-back")}>
            开始训练
            <Icon name="arrow" size={16} />
          </button>
        )}
      </div>
      {!user ? (
        <section className="empty-state card">
          <div className="modal-icon">
            <Icon name="chart" size={28} />
          </div>
          <h2>你的训练记录，等你开启</h2>
          <p>
            使用个人 Token 登录，保存每次完整练习，
            <br />
            查看各难度的最佳成绩。
          </p>
          <button className="primary" onClick={onLogin}>
            Token 登录
          </button>
        </section>
      ) : (
        <>
          <div className="section-heading">
            <h2>各难度最佳</h2>
            <span>空间 N-back · 平衡准确率</span>
          </div>
          <div className="bests-grid">
            {[1, 2, 3, 4, 5].map((n) => {
              const best = bests.find((x) => x.n === n);
              return (
                <section className="best-card" key={n}>
                  <span>{n}-back</span>
                  <strong>
                    {best ? formatScore(best.score) : "—"}
                    <small>{best ? "分" : ""}</small>
                  </strong>
                  <p>{best ? formatTime(best.completedAt) : "暂无记录"}</p>
                </section>
              );
            })}
          </div>
          <div className="section-heading history-heading">
            <h2>训练历史</h2>
            <span>{history ? `共 ${history.total} 局` : "仅本人可见"}</span>
          </div>
          {error ? (
            <div className="card error-panel">
              <p role="alert">{error}</p>
              <button
                className="secondary"
                onClick={() => setRefresh((x) => x + 1)}
              >
                重新加载
              </button>
            </div>
          ) : busy ? (
            <div className="card empty-row" role="status">
              正在读取记录…
            </div>
          ) : !history?.items.length ? (
            <div className="card empty-row">
              <p>还没有训练记录。</p>
              <button className="text-link" onClick={() => go("n-back")}>
                开始第一局
                <Icon name="arrow" size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="table-scroll card">
                <table>
                  <thead>
                    <tr>
                      <th>完成时间</th>
                      <th>难度</th>
                      <th>平衡准确率</th>
                      <th>命中</th>
                      <th>漏报</th>
                      <th>误报</th>
                      <th>正确拒绝</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.items.map((x) => (
                      <tr key={x.resultId}>
                        <td>{formatTime(x.completedAt)}</td>
                        <td>
                          <span className="difficulty-tag">{x.n}-back</span>
                        </td>
                        <td className="table-score">
                          {formatScore(x.score)}
                          <small> 分</small>
                        </td>
                        <td>{x.tp}</td>
                        <td>{x.fn}</td>
                        <td>{x.fp}</td>
                        <td>{x.tn}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <button
                  className="secondary compact"
                  disabled={page <= 1}
                  onClick={() => setPage((x) => x - 1)}
                >
                  上一页
                </button>
                <span>第 {page} 页</span>
                <button
                  className="secondary compact"
                  disabled={page * history.pageSize >= history.total}
                  onClick={() => setPage((x) => x + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
