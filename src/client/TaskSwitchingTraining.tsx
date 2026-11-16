import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "./api";
import {
  TaskSwitchingGame,
  type TaskSwitchingSnapshot,
} from "./task-switching-game";
import { TaskSwitchingSummary } from "./TaskSwitchingSummary";
import {
  generateTaskSwitchingTrials,
  TASK_SWITCHING_LABELS,
  TASK_SWITCHING_RULE_NAMES,
  validateTaskSwitchingSummary,
} from "../shared/task-switching";
import {
  TASK_SWITCHING_GAME,
  type GameId,
  type User,
  type TaskSwitchingAnswer,
  type TaskSwitchingSummary as Summary,
  type TaskSwitchingResultInput,
  type TaskSwitchingSavedResult,
} from "../shared/contracts";

interface Outcome {
  summary: Summary;
  warmup: boolean;
  owner: User | null;
  payload: TaskSwitchingResultInput | null;
}
// Visibility timeline closes delayed-event races where supported; current state/events cover other browsers.
function hiddenSince(since: number): boolean {
  if (document.hidden) return true;
  if (!("VisibilityStateEntry" in window)) return false;
  return performance
    .getEntriesByType("visibility-state")
    .some((entry) => entry.name === "hidden" && entry.startTime >= since);
}
export function TaskSwitchingTraining({
  user,
  offline,
  onUser,
  onError,
  onSaved,
  onRecords,
  onAbortNotice,
}: {
  user: User | null;
  offline: boolean;
  onUser: (user: User | null) => void;
  onError: (err: unknown) => void;
  onSaved: () => void;
  onRecords: (game: GameId) => void;
  onAbortNotice: () => void;
}) {
  const [mode, setMode] = useState<"setup" | "running" | "result" | "aborted">(
    "setup",
  );
  const [snapshot, setSnapshot] = useState<TaskSwitchingSnapshot | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [starting, setStarting] = useState(false),
    [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "none" | "saving" | "saved" | "failed"
  >("none");
  const alive = useRef(false),
    task = useRef(0),
    engine = useRef<TaskSwitchingGame | null>(null);
  const context = useRef<{
    warmup: boolean;
    owner: User | null;
    id: string;
    started: number;
    startedUtc: number;
  } | null>(null);
  const result = useRef<Outcome | null>(null),
    saving = useRef(new Set<string>()),
    animation = useRef(0);
  const lastSnapshot = useRef(""),
    heading = useRef<HTMLHeadingElement>(null),
    firstButton = useRef<HTMLButtonElement>(null);
  const presentedId = useRef(-1);
  const shortcutPress = useRef(new Set<string>());
  const currentUser = useRef(user);
  currentUser.current = user;
  const startingRef = useRef(false);
  const pointerPress = useRef(
    new Map<number, { id: number; answer: number }>(),
  );
  const releasedPress = useRef<{ id: number; answer: number } | null>(null);
  const keyboardPress = useRef<{ id: number; consumed: boolean } | null>(null);
  const submit = useCallback(
    async (value: Outcome) => {
      const payload = value.payload;
      if (!payload || saving.current.has(payload.resultId)) return;
      saving.current.add(payload.resultId);
      setSaveStatus("saving");
      setError("");
      try {
        const saved = await api<TaskSwitchingSavedResult>("results", payload);
        if (alive.current && result.current === value) {
          setOutcome({ ...value, summary: saved });
          setSaveStatus("saved");
          if (value.owner && currentUser.current?.id === value.owner.id)
            onUser(value.owner);
          onSaved();
        }
      } catch (err) {
        if (alive.current && result.current === value) {
          setSaveStatus("failed");
          setError((err as Error).message);
          onError(err);
        }
      } finally {
        saving.current.delete(payload.resultId);
      }
    },
    [onError, onSaved, onUser],
  );
  const publish = useCallback(() => {
    const game = engine.current,
      ctx = context.current;
    if (!game || !ctx || !alive.current) return null;
    if (!game.result && hiddenSince(ctx.started)) game.abort();
    const state = game.tick(performance.now());
    const key = JSON.stringify(state);
    if (lastSnapshot.current !== key) {
      lastSnapshot.current = key;
      setSnapshot(state);
    }
    const complete = game.result;
    if (complete && !result.current) {
      validateTaskSwitchingSummary(complete, ctx.warmup);
      const value: Outcome = {
        summary: complete,
        warmup: ctx.warmup,
        owner: ctx.owner,
        payload:
          ctx.owner && !ctx.warmup
            ? {
                ...complete,
                game: TASK_SWITCHING_GAME,
                version: 1,
                resultId: ctx.id,
                startedByUserId: ctx.owner.id,
                completedAt: new Date(
                  ctx.startedUtc +
                    Math.round(game.completedAtMono! - ctx.started),
                ).toISOString(),
              }
            : null,
      };
      result.current = value;
      setOutcome(value);
      if (value.payload) void submit(value);
    }
    if (state.phase === "aborted") setMode("aborted");
    if (state.phase === "finished") setMode("result");
    return state;
  }, [submit]);
  const abort = useCallback(() => {
    task.current++;
    startingRef.current = false;
    setStarting(false);
    engine.current?.abort();
    publish();
  }, [publish]);
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.hidden) abort();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", abort);
    return () => {
      alive.current = false;
      task.current++;
      cancelAnimationFrame(animation.current);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", abort);
      const game = engine.current;
      if (
        game &&
        !game.result &&
        game.tick(performance.now()).phase !== "aborted"
      ) {
        game.abort();
        onAbortNotice();
      }
    };
  }, [abort, onAbortNotice]);
  useEffect(() => {
    if (mode !== "running") return;
    const frame = () => {
      const state = publish();
      if (state && ["question", "feedback"].includes(state.phase))
        animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animation.current);
  }, [mode, publish]);
  useLayoutEffect(() => {
    if (!snapshot || mode !== "running") return;
    presentedId.current = snapshot.presentationId;
    engine.current?.commit(snapshot.presentationId, performance.now());
    publish();
    if (snapshot.phase === "question" && snapshot.trialIndex === 0)
      firstButton.current?.focus({ preventScroll: true });
  }, [snapshot?.presentationId, mode, publish]);
  useEffect(() => {
    if (mode === "result" || mode === "aborted")
      heading.current?.focus({ preventScroll: true });
  }, [mode]);
  const start = async (warmup: boolean, asGuest = false) => {
    if (startingRef.current) return;
    const ticket = ++task.current,
      expected = currentUser.current;
    startingRef.current = true;
    setStarting(true);
    setError("");
    try {
      let owner: User | null = null;
      if (!warmup && !asGuest) {
        if (!expected) throw new Error("请登录或明确选择游客练习");
        const data = await api<{ user: User }>("me");
        if (!alive.current || task.current !== ticket) return;
        if (
          data.user.id !== expected.id ||
          currentUser.current?.id !== expected.id
        ) {
          onUser(data.user);
          throw new ApiError(
            409,
            "IDENTITY_CONFLICT",
            "账户已变化，请重新确认开局",
          );
        }
        owner = data.user;
        onUser(owner);
      }
      if (!alive.current || task.current !== ticket || document.hidden) return;
      const game = new TaskSwitchingGame(generateTaskSwitchingTrials(warmup));
      context.current = {
        warmup,
        owner,
        id: crypto.randomUUID(),
        started: performance.now(),
        startedUtc: Date.now(),
      };
      engine.current = game;
      result.current = null;
      setOutcome(null);
      setSaveStatus("none");
      pointerPress.current.clear();
      releasedPress.current = null;
      keyboardPress.current = null;
      shortcutPress.current.clear();
      lastSnapshot.current = "";
      setMode("running");
      publish();
    } catch (err) {
      if (alive.current && task.current === ticket) {
        setError((err as Error).message);
        onError(err);
      }
    } finally {
      if (alive.current && task.current === ticket) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  };
  const setup = () => {
    abort();
    engine.current = null;
    context.current = null;
    result.current = null;
    setOutcome(null);
    setSnapshot(null);
    setError("");
    setSaveStatus("none");
    setMode("setup");
  };
  const respond = (answer: TaskSwitchingAnswer, receipt: number) => {
    if (
      context.current &&
      !engine.current?.result &&
      hiddenSince(context.current.started)
    )
      engine.current?.abort();
    else engine.current?.answer(answer, performance.now(), receipt);
    publish();
  };
  useEffect(() => {
    if (mode !== "running") return;
    const down = (event: KeyboardEvent) => {
      if (
        !["KeyF", "KeyJ"].includes(event.code) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),dialog[open],[role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      if (event.repeat || shortcutPress.current.has(event.code)) return;
      shortcutPress.current.add(event.code);
      respond(event.code === "KeyF" ? 0 : 1, presentedId.current);
    };
    const up = (event: KeyboardEvent) =>
      shortcutPress.current.delete(event.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, publish]);
  const startActions = (
    <div className="task-switching-start-actions">
      {user && (
        <button
          className="primary"
          data-testid="task-switching-start"
          disabled={starting || offline}
          onClick={() => void start(false)}
        >
          开始本局
        </button>
      )}
      <button
        className={user ? "secondary" : "primary"}
        disabled={starting}
        onClick={() => void start(false, true)}
      >
        以游客身份练习
      </button>
    </div>
  );
  if (mode === "running" && snapshot) {
    const active = snapshot.phase === "question" && snapshot.committed;
    const warmup = context.current!.warmup;
    return (
      <section className="task-switching-training">
        <div className="section-heading">
          <h1>{warmup ? "规则切换热身" : "规则切换"}</h1>
          <span data-testid="task-switching-progress">
            {snapshot.trialIndex === 0
              ? "起始题（不计分）"
              : `${warmup ? "练习题" : "计分题"} ${snapshot.trialIndex} / ${warmup ? 8 : 40}`}
          </span>
        </div>
        <p>根据提示判断奇偶或大小。每题最多 3 秒。</p>
        <div
          className="task-switching-stimulus"
          data-testid="task-switching-stimulus"
        >
          {snapshot.phase === "question" && snapshot.trial ? (
            <div>
              <p
                className="task-switching-rule"
                data-testid="task-switching-rule"
              >
                {TASK_SWITCHING_RULE_NAMES[snapshot.trial.rule]}
              </p>
              <span
                className="task-switching-word"
                data-testid="task-switching-word"
              >
                {snapshot.trial.number}
              </span>
            </div>
          ) : (
            <div role="status" data-testid="task-switching-feedback">
              <strong>
                {snapshot.feedback?.kind === "correct"
                  ? "正确"
                  : snapshot.feedback?.kind === "wrong"
                    ? "错误"
                    : "超时"}
              </strong>
              {snapshot.feedback?.kind !== "correct" && snapshot.feedback && (
                <p>
                  正确答案：
                  {
                    TASK_SWITCHING_LABELS[snapshot.feedback.rule][
                      snapshot.feedback.answer
                    ]
                  }
                </p>
              )}
            </div>
          )}
        </div>
        <div
          className="task-switching-answers"
          role="group"
          aria-label="选择当前规则的答案"
        >
          {TASK_SWITCHING_LABELS[
            snapshot.trial?.rule ?? snapshot.feedback?.rule ?? "parity"
          ].map((label, i) => (
            <button
              type="button"
              className="secondary"
              key={i}
              ref={i === 0 ? firstButton : undefined}
              aria-disabled={!active}
              aria-keyshortcuts={i === 0 ? "F" : "J"}
              onPointerDown={(event) => {
                pointerPress.current.set(event.pointerId, {
                  id: snapshot.presentationId,
                  answer: i,
                });
              }}
              onPointerUp={(event) => {
                releasedPress.current =
                  pointerPress.current.get(event.pointerId) ?? null;
                pointerPress.current.delete(event.pointerId);
              }}
              onPointerCancel={(event) => {
                pointerPress.current.delete(event.pointerId);
                releasedPress.current = null;
              }}
              onKeyDown={(event) => {
                if (event.key !== " " && event.key !== "Enter") return;
                if (event.repeat) {
                  event.preventDefault();
                  return;
                }
                keyboardPress.current = {
                  id: snapshot.presentationId,
                  consumed: false,
                };
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  const press = keyboardPress.current;
                  setTimeout(() => {
                    if (keyboardPress.current === press)
                      keyboardPress.current = null;
                  }, 0);
                }
              }}
              onClick={(event) => {
                if (event.detail > 0) {
                  const press = releasedPress.current;
                  releasedPress.current = null;
                  if (press?.answer === i)
                    respond(i as TaskSwitchingAnswer, press.id);
                } else {
                  const press = keyboardPress.current;
                  if (press?.consumed) return;
                  if (press) press.consumed = true;
                  respond(
                    i as TaskSwitchingAnswer,
                    press?.id ?? snapshot.presentationId,
                  );
                }
              }}
            >
              <span>{label}</span>
              <kbd aria-hidden="true">{i === 0 ? "F" : "J"}</kbd>
            </button>
          ))}
        </div>
        <div className="task-switching-training-footer">
          <span className="fine">
            {warmup ? "热身不保存成绩" : "中途离开或切后台，本局作废"}
          </span>
          <button className="text-button" onClick={abort}>
            结束本局
          </button>
        </div>
      </section>
    );
  }
  if (mode === "aborted")
    return (
      <section
        className="card task-switching-panel"
        data-testid="task-switching-abort"
      >
        <h1 ref={heading} tabIndex={-1}>
          本局已作废
        </h1>
        <p>训练未完成，不计入历史和最佳成绩。</p>
        <button className="primary" onClick={setup}>
          返回准备页
        </button>
      </section>
    );
  if (mode === "result" && outcome)
    return (
      <section
        className="card task-switching-panel"
        data-testid="task-switching-result"
      >
        <h1 ref={heading} tabIndex={-1}>
          {outcome.warmup ? "热身完成" : "本局完成"}
        </h1>
        <TaskSwitchingSummary summary={outcome.summary} />
        {outcome.warmup ? (
          <>
            <p>热身不保存成绩。准备好后，开始一局 40 题正式训练。</p>
            {startActions}
          </>
        ) : outcome.payload ? (
          <>
            <p role="status">
              {saveStatus === "saved"
                ? "成绩已保存"
                : saveStatus === "saving"
                  ? "正在保存成绩…"
                  : "成绩未保存，可在此页面重试。"}
            </p>
            {saveStatus === "failed" && (
              <button
                className="secondary"
                onClick={() => void submit(outcome)}
              >
                重试保存
              </button>
            )}
            <button
              className="primary"
              onClick={() => onRecords(TASK_SWITCHING_GAME)}
            >
              查看个人记录
            </button>
          </>
        ) : (
          <p>本局为游客练习，成绩不保存，登录后也不会补传。</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" onClick={setup}>
          返回准备页
        </button>
      </section>
    );
  return (
    <>
      <div className="home-heading">
        <h1>规则切换</h1>
        <p>看清规则，及时切换。</p>
      </div>
      <div className="corsi-setup-grid">
        <section className="card task-switching-panel">
          <h2>怎么玩</h2>
          <ol>
            <li>根据本题提示，判断数字的奇偶或与 5 比较大小。</li>
            <li>
              左侧／F 对应奇数或小于 5，右侧／J 对应偶数或大于 5；每题最多 3
              秒，只接受第一次回答。
            </li>
            <li>每题后查看简短反馈，再继续下一题。</li>
          </ol>
          <div className="task-switching-example">
            <span>2</span>
            <p>提示“判断奇偶”时选“偶数”；提示“比较大小”时选“小于 5”。</p>
          </div>
          <p>
            数字为 1～9，不出现 5。先做 1 道不计分的起始题，再完成 40
            道计分题：重复与切换各 20
            道。先比较准确率，再比较正确题平均反应时间。
          </p>
          <p className="fine">
            中途离开、切后台或锁屏会使未完成局作废。反应时间只统计正确题。
          </p>
        </section>
        <section className="card task-switching-panel">
          <h2>准备训练</h2>
          <p>可先做 1 道起始题＋8 道练习题，熟悉切换。热身不保存。</p>
          <button
            className="secondary"
            disabled={starting}
            onClick={() => void start(true)}
          >
            先做热身
          </button>
          {startActions}
          <p className="fine">游客练习可离线进行，不保存私人历史和最佳成绩。</p>
          {starting && <p role="status">正在准备…</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      <button
        className="text-link"
        onClick={() => {
          location.hash = "home";
        }}
      >
        ← 返回训练大厅
      </button>
    </>
  );
}
