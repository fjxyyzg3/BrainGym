import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "./api";
import {
  MentalRotationGame,
  type RotationSnapshot,
} from "./mental-rotation-game";
import { RotationFigure } from "./RotationFigure";
import { RotationSummary } from "./RotationSummary";
import {
  generateRotationTrials,
  validateRotationSummary,
  ROTATION_RELATIONS,
  ROTATION_RELATION_NAMES,
} from "../shared/mental-rotation";
import {
  ROTATION_GAME,
  type GameId,
  type User,
  type RotationRelation,
  type RotationSummary as Summary,
  type RotationResultInput,
  type RotationSavedResult,
} from "../shared/contracts";
import { ROTATION_SHAPES } from "../shared/rotation-shapes";

interface Outcome {
  summary: Summary;
  warmup: boolean;
  owner: User | null;
  payload: RotationResultInput | null;
}
function hiddenSince(since: number) {
  if (document.hidden) return true;
  if (!("VisibilityStateEntry" in window)) return false;
  return performance
    .getEntriesByType("visibility-state")
    .some((e) => e.name === "hidden" && e.startTime >= since);
}
export function MentalRotationTraining({
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
  onError: (error: unknown) => void;
  onSaved: () => void;
  onRecords: (game: GameId) => void;
  onAbortNotice: () => void;
}) {
  const [mode, setMode] = useState<"setup" | "running" | "result" | "aborted">(
    "setup",
  );
  const [snapshot, setSnapshot] = useState<RotationSnapshot | null>(null),
    [outcome, setOutcome] = useState<Outcome | null>(null);
  const [starting, setStarting] = useState(false),
    [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "none" | "saving" | "saved" | "failed"
  >("none");
  const alive = useRef(false),
    task = useRef(0),
    engine = useRef<MentalRotationGame | null>(null);
  const context = useRef<{
    warmup: boolean;
    owner: User | null;
    id: string;
    started: number;
  } | null>(null);
  const result = useRef<Outcome | null>(null),
    saving = useRef(new Set<string>()),
    animation = useRef(0),
    lastSnapshot = useRef("");
  const heading = useRef<HTMLHeadingElement>(null),
    firstButton = useRef<HTMLButtonElement>(null);
  const currentUser = useRef(user);
  currentUser.current = user;
  const startingRef = useRef(false);
  const pointerPress = useRef(
    new Map<number, { id: number; relation: RotationRelation }>(),
  );
  const releasedPress = useRef<{
    id: number;
    relation: RotationRelation;
  } | null>(null);
  const keyboardPress = useRef<{ id: number; consumed: boolean } | null>(null);
  const submit = useCallback(
    async (value: Outcome) => {
      const payload = value.payload;
      if (!payload || saving.current.has(payload.resultId)) return;
      saving.current.add(payload.resultId);
      setSaveStatus("saving");
      setError("");
      try {
        await api<RotationSavedResult>("results", payload);
        if (alive.current && result.current === value) {
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
    const state = game.tick(performance.now()),
      key = JSON.stringify(state);
    if (lastSnapshot.current !== key) {
      lastSnapshot.current = key;
      setSnapshot(state);
    }
    const complete = game.result;
    if (complete && !result.current) {
      validateRotationSummary(complete, ctx.warmup);
      const value: Outcome = {
        summary: complete,
        warmup: ctx.warmup,
        owner: ctx.owner,
        payload:
          ctx.owner && !ctx.warmup
            ? {
                ...complete,
                game: ROTATION_GAME,
                version: 1,
                resultId: ctx.id,
                startedByUserId: ctx.owner.id,
                completedAt: new Date().toISOString(),
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
      const started = performance.now(),
        game = new MentalRotationGame(generateRotationTrials(warmup));
      if (hiddenSince(started)) return;
      context.current = { warmup, owner, id: crypto.randomUUID(), started };
      engine.current = game;
      result.current = null;
      setOutcome(null);
      setSaveStatus("none");
      pointerPress.current.clear();
      releasedPress.current = null;
      keyboardPress.current = null;
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
  const respond = (relation: RotationRelation, id: number) => {
    if (
      context.current &&
      !engine.current?.result &&
      hiddenSince(context.current.started)
    )
      engine.current?.abort();
    else engine.current?.answer(relation, performance.now(), id);
    publish();
  };
  const startActions = (
    <div className="rotation-start-actions">
      {user && (
        <button
          className="primary"
          data-testid="rotation-start"
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
    const active = snapshot.phase === "question" && snapshot.committed,
      warmup = context.current!.warmup;
    return (
      <section className="rotation-training">
        <div className="section-heading">
          <h1>{warmup ? "心理旋转热身" : "心理旋转"}</h1>
          <span data-testid="rotation-progress">
            {snapshot.trialIndex + 1} / {warmup ? 8 : 32}
          </span>
        </div>
        <p>只转动能重合，还是需要镜像？每题不限时。</p>
        {snapshot.trial && <RotationFigure trial={snapshot.trial} />}
        <div
          className="rotation-feedback"
          role="status"
          data-testid="rotation-feedback"
        >
          {snapshot.feedback ? (
            <>
              <strong>
                {snapshot.feedback.kind === "correct" ? "正确" : "错误"}
              </strong>
              <span>
                正确答案：{ROTATION_RELATION_NAMES[snapshot.feedback.relation]}
              </span>
            </>
          ) : (
            <span>请选择两张图的关系</span>
          )}
        </div>
        <div
          className="rotation-answers"
          role="group"
          aria-label="判断图形关系"
        >
          {ROTATION_RELATIONS.map((relation, i) => (
            <button
              type="button"
              className="secondary"
              key={relation}
              ref={i === 0 ? firstButton : undefined}
              aria-disabled={!active}
              onPointerDown={(e) => {
                pointerPress.current.set(e.pointerId, {
                  id: snapshot.presentationId,
                  relation,
                });
              }}
              onPointerUp={(e) => {
                releasedPress.current =
                  pointerPress.current.get(e.pointerId) ?? null;
                pointerPress.current.delete(e.pointerId);
              }}
              onPointerCancel={(e) => {
                pointerPress.current.delete(e.pointerId);
                releasedPress.current = null;
              }}
              onKeyDown={(e) => {
                if (e.key !== " " && e.key !== "Enter") return;
                if (e.repeat) {
                  e.preventDefault();
                  return;
                }
                keyboardPress.current = {
                  id: snapshot.presentationId,
                  consumed: false,
                };
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  const press = keyboardPress.current;
                  setTimeout(() => {
                    if (keyboardPress.current === press)
                      keyboardPress.current = null;
                  }, 0);
                }
              }}
              onClick={(e) => {
                if (e.detail > 0) {
                  const press = releasedPress.current;
                  releasedPress.current = null;
                  if (press?.relation === relation) respond(relation, press.id);
                } else {
                  const press = keyboardPress.current;
                  if (press?.consumed) return;
                  if (press) press.consumed = true;
                  respond(relation, press?.id ?? snapshot.presentationId);
                }
              }}
            >
              {ROTATION_RELATION_NAMES[relation]}
            </button>
          ))}
        </div>
        <div className="rotation-training-footer">
          <span className="fine">
            {warmup
              ? "热身不保存成绩"
              : `${context.current!.owner ? "账号训练" : "游客练习"} · 中途离开或切后台，本局作废`}
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
      <section className="card rotation-panel" data-testid="rotation-abort">
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
      <section className="card rotation-panel" data-testid="rotation-result">
        <h1 ref={heading} tabIndex={-1}>
          {outcome.warmup ? "热身完成" : "本局完成"}
        </h1>
        <RotationSummary summary={outcome.summary} />
        {outcome.warmup ? (
          <>
            <p>热身不保存成绩。准备好后，手动开始一局 32 题正式训练。</p>
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
              onClick={() => onRecords(ROTATION_GAME)}
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
        <h1>心理旋转</h1>
        <p>在脑海中转动图形，辨认镜像。</p>
      </div>
      <div className="corsi-setup-grid">
        <section className="card rotation-panel">
          <h2>怎么玩</h2>
          <ol>
            <li>同时观察参考图和待判断图。</li>
            <li>只转动就能重合，选“仅旋转”；需要左右翻转再转动，选“镜像”。</li>
            <li>每题不限时，只接受第一次回答；反馈后自动下一题。</li>
          </ol>
          <RotationFigure
            trial={{
              shape: ROTATION_SHAPES.simple[0].map((p) => [...p]),
              complexity: "simple",
              angle: 90,
              relation: "rotation",
              baseTurns: 0,
              rotation: 90,
            }}
          />
          <p>上面的两张图只需转动就能重合，应选“仅旋转”。</p>
          <details>
            <summary>查看镜像示例</summary>
            <RotationFigure
              trial={{
                shape: ROTATION_SHAPES.simple[1].map((p) => [...p]),
                complexity: "simple",
                angle: 90,
                relation: "mirror",
                baseTurns: 0,
                rotation: 90,
              }}
            />
            <p>这组图需要先左右翻转再转动，应选“镜像”。</p>
          </details>
          <p>
            一局 32 题，混合简单／复杂图形和四种角度；“仅旋转”和“镜像”各 16 题。
          </p>
          <p className="fine">
            先比较准确率，再比较正确题平均用时。中途离开、切后台或锁屏会使未完成局作废。
          </p>
        </section>
        <section className="card rotation-panel">
          <h2>准备训练</h2>
          <p>可先做 8 题热身，熟悉两种判断。热身不保存。</p>
          <button
            className="secondary"
            disabled={starting}
            onClick={() => void start(true)}
          >
            先做热身
          </button>
          {startActions}
          <p className="fine">游客可离线练习，不保存私人历史和最佳成绩。</p>
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
