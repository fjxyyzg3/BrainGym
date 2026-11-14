import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "./api";
import { CorsiGame, type CorsiSnapshot } from "./corsi-game";
import { corsiCompletedAt, corsiScore, nextCorsiStart } from "../shared/corsi";
import {
  CORSI_FORWARD,
  CORSI_BACKWARD,
  CORSI_GAME_IDS,
  type CorsiGameId,
  type CorsiProgress,
  type CorsiResultInput,
  type CorsiSavedResult,
  type CorsiSummary,
  type GameId,
  type User,
} from "../shared/contracts";

type Outcome = {
  summary: CorsiSummary & { game: CorsiGameId };
  owner: User | null;
  payload: CorsiResultInput | null;
  score: number;
};
export function CorsiTraining({
  gameId,
  user,
  offline,
  guestStarts,
  onGuestStart,
  onRecords,
  onUser,
  onError,
  onSaved,
  onAbortNotice,
}: {
  gameId: CorsiGameId;
  user: User | null;
  offline: boolean;
  guestStarts: Record<CorsiGameId, number>;
  onGuestStart: (game: CorsiGameId, length: number) => void;
  onRecords: (game: GameId) => void;
  onUser: (user: User | null) => void;
  onError: (error: unknown) => void;
  onSaved: () => void;
  onAbortNotice: () => void;
}) {
  const [mode, setMode] = useState<"setup" | "running" | "result" | "aborted">(
    "setup",
  );
  const [profile, setProfile] = useState<CorsiProgress | null>(null);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [starting, setStarting] = useState(false);
  const [snapshot, setSnapshot] = useState<CorsiSnapshot | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "guest" | "saving" | "saved" | "failed"
  >("guest");
  const [pressed, setPressed] = useState<number | null>(null);
  const engine = useRef<CorsiGame | null>(null),
    alive = useRef(true),
    task = useRef(0),
    animation = useRef(0),
    lastSnapshot = useRef(""),
    completed = useRef(false),
    saving = useRef(false),
    stepPending = useRef(false),
    resultRef = useRef<Outcome | null>(null),
    frozen = useRef<{
      owner: User | null;
      epoch: number;
      serverNow: number;
      anchorMono: number;
      id: string;
    } | null>(null),
    pulse = useRef<ReturnType<typeof setTimeout> | null>(null),
    firstCell = useRef<HTMLButtonElement>(null),
    nextButton = useRef<HTMLButtonElement>(null),
    terminalHeading = useRef<HTMLHeadingElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    resetExpected = useRef<{
      userId: string | null;
      epoch: number;
      game: CorsiGameId;
    } | null>(null);
  const currentUser = useRef(user);
  currentUser.current = user;
  const profileRequest = useRef(0);
  useEffect(() => {
    if (mode === "result" || mode === "aborted")
      terminalHeading.current?.focus({ preventScroll: true });
  }, [mode]);

  const readProgress = useCallback(
    async (expectedUser: User) => {
      const request = ++profileRequest.current;
      const progress = await api<CorsiProgress>("corsi/progress");
      const anchorMono = performance.now();
      if (!alive.current || request !== profileRequest.current) return null;
      if (currentUser.current?.id !== expectedUser.id)
        throw new ApiError(
          409,
          "IDENTITY_CONFLICT",
          "账户已变化，请重新确认操作",
        );
      if (progress.user.id !== expectedUser.id) {
        setProfile(null);
        onUser(progress.user);
        throw new ApiError(
          409,
          "IDENTITY_CONFLICT",
          "账户已变化，请重新确认操作",
        );
      }
      setProfile(progress);
      setProgressError("");
      onUser(progress.user);
      return { progress, anchorMono };
    },
    [onUser],
  );
  useEffect(() => {
    setProfile(null);
    setProgressError("");
    if (user)
      void readProgress(user).catch((err) => {
        if (alive.current) {
          setProgressError((err as Error).message);
          onError(err);
        }
      });
    return () => {
      profileRequest.current++;
    };
  }, [user?.id, readProgress, onError]);

  const submit = useCallback(
    async (result: Outcome) => {
      if (!result.payload || !result.owner || saving.current) return;
      saving.current = true;
      setSaveStatus("saving");
      setError("");
      try {
        const saved = await api<CorsiSavedResult>("results", result.payload);
        if (!alive.current || resultRef.current !== result) return;
        setOutcome({ ...result, score: saved.score });
        setSaveStatus("saved");
        onSaved();
        try {
          await readProgress(result.owner);
        } catch (err) {
          if (alive.current && resultRef.current === result) {
            setProgressError(
              `成绩已保存，当前起点读取失败：${(err as Error).message}`,
            );
            onError(err);
          }
        }
      } catch (err) {
        if (alive.current && resultRef.current === result) {
          setSaveStatus("failed");
          setError((err as Error).message);
          onError(err);
        }
      } finally {
        saving.current = false;
      }
    },
    [onSaved, onError, readProgress],
  );
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const publish = useCallback(() => {
    const game = engine.current;
    if (!alive.current || !game) return null;
    const now = performance.now(),
      state = game.tick(now);
    const key = JSON.stringify(state);
    if (key !== lastSnapshot.current) {
      lastSnapshot.current = key;
      setSnapshot(state);
    }
    if (state.phase === "aborted") {
      setMode("aborted");
      cancelAnimationFrame(animation.current);
    }
    if (state.phase === "finished" && !completed.current) {
      completed.current = true;
      cancelAnimationFrame(animation.current);
      const summary = game.result!,
        context = frozen.current!;
      try {
        const result: Outcome = {
          summary,
          owner: context.owner,
          score: corsiScore(summary),
          payload: context.owner
            ? {
                ...summary,
                resultId: context.id,
                startedByUserId: context.owner.id,
                version: 1,
                progressEpoch: context.epoch,
                completedAt: corsiCompletedAt(
                  context.serverNow,
                  context.anchorMono,
                  now,
                ),
              }
            : null,
        };
        resultRef.current = result;
        setOutcome(result);
        setMode("result");
        setSaveStatus(result.payload ? "saving" : "guest");
        if (result.payload) void submitRef.current(result);
        else onGuestStart(summary.game, nextCorsiStart(summary));
      } catch (err) {
        setError((err as Error).message);
        setMode("aborted");
      }
    }
    return state;
  }, [onGuestStart]);
  const pump = useCallback(
    function frame() {
      const state = publish();
      if (state && ["presenting", "recalling"].includes(state.phase))
        animation.current = requestAnimationFrame(frame);
    },
    [publish],
  );
  const abort = useCallback(() => {
    task.current++;
    setStarting(false);
    engine.current?.abort();
    cancelAnimationFrame(animation.current);
    if (
      alive.current &&
      engine.current?.tick(performance.now()).phase === "aborted"
    )
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
      profileRequest.current++;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", abort);
      cancelAnimationFrame(animation.current);
      if (pulse.current) clearTimeout(pulse.current);
      const game = engine.current;
      if (
        game &&
        !["finished", "aborted"].includes(game.tick(performance.now()).phase)
      ) {
        game.abort();
        onAbortNotice();
      }
    };
  }, [abort, onAbortNotice]);
  useLayoutEffect(() => {
    if (!snapshot || !engine.current) return;
    if (snapshot.phase === "presenting" || snapshot.phase === "recalling") {
      engine.current.commit(
        snapshot.presentationId,
        snapshot.slot,
        performance.now(),
      );
      publish();
      if (snapshot.phase === "recalling")
        firstCell.current?.focus({ preventScroll: true });
    } else if (snapshot.phase === "feedback")
      nextButton.current?.focus({ preventScroll: true });
  }, [snapshot?.presentationId, snapshot?.slot, snapshot?.phase, publish]);
  const respond = useCallback(
    (cell: number) => {
      if (engine.current?.answer(cell, performance.now())) {
        setPressed(cell);
        if (pulse.current) clearTimeout(pulse.current);
        pulse.current = setTimeout(() => setPressed(null), 120);
        publish();
      }
    },
    [publish],
  );
  useEffect(() => {
    if (mode !== "running") return;
    const key = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
      if (digit) {
        event.preventDefault();
        if (!event.repeat) respond(Number(digit[1]) - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, respond]);

  const start = async (asGuest: boolean) => {
    if (starting || stepPending.current) return;
    const token = ++task.current;
    setStarting(true);
    setError("");
    try {
      let owner: User | null = null,
        length = guestStarts[gameId],
        epoch = 0,
        serverNow = 0,
        anchorMono = 0;
      if (!asGuest) {
        if (!user) throw new Error("请登录或明确选择游客练习");
        const loaded = await readProgress(user);
        if (!loaded) return;
        const item = loaded.progress.items.find((x) => x.game === gameId)!;
        owner = loaded.progress.user;
        length = item.nextStartLength;
        epoch = item.progressEpoch;
        serverNow = loaded.progress.serverNow;
        anchorMono = loaded.anchorMono;
        corsiCompletedAt(serverNow, anchorMono, anchorMono);
      }
      if (!alive.current || token !== task.current || document.hidden) return;
      frozen.current = {
        owner,
        epoch,
        serverNow,
        anchorMono,
        id: crypto.randomUUID(),
      };
      const game = new CorsiGame(gameId, length);
      engine.current = game;
      resultRef.current = null;
      setOutcome(null);
      completed.current = false;
      lastSnapshot.current = "";
      setMode("running");
      publish();
      await game.prepare();
      if (!alive.current || token !== task.current || document.hidden) {
        game.abort();
        return;
      }
      pump();
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message);
        onError(err);
      }
    } finally {
      if (alive.current && token === task.current) setStarting(false);
    }
  };
  const next = async () => {
    if (stepPending.current || !engine.current) return;
    stepPending.current = true;
    const token = task.current;
    cancelAnimationFrame(animation.current);
    const preparation = engine.current.next();
    publish();
    try {
      await preparation;
      if (alive.current && token === task.current && !document.hidden) pump();
    } finally {
      stepPending.current = false;
    }
  };
  const setup = () => {
    abort();
    engine.current = null;
    frozen.current = null;
    resultRef.current = null;
    setOutcome(null);
    setSnapshot(null);
    setMode("setup");
    setError("");
  };
  const openReset = () => {
    if (user && (!profile || profile.user.id !== user.id)) {
      setError("尚未读取当前起点，请先重新读取");
      return;
    }
    resetExpected.current = {
      userId: user?.id ?? null,
      epoch: profile?.items.find((x) => x.game === gameId)?.progressEpoch ?? 0,
      game: gameId,
    };
    dialog.current?.showModal();
  };
  const confirmReset = async () => {
    const expected = resetExpected.current;
    if (!expected) return;
    dialog.current?.close();
    setStarting(true);
    setError("");
    try {
      if (expected.userId === null) {
        onGuestStart(expected.game, 2);
      } else {
        const p = await api<CorsiProgress>("corsi/progress/reset", {
          game: expected.game,
          expectedUserId: expected.userId,
          expectedEpoch: expected.epoch,
        });
        if (!alive.current) return;
        if (
          p.user.id !== expected.userId ||
          currentUser.current?.id !== expected.userId
        )
          throw new ApiError(
            409,
            "IDENTITY_CONFLICT",
            "账户已变化，请重新确认恢复",
          );
        profileRequest.current++;
        setProfile(p);
        setProgressError("");
        onUser(p.user);
        onSaved();
      }
      if (mode === "aborted") setup();
    } catch (err) {
      if (!alive.current) return;
      setError(`恢复结果需重新确认：${(err as Error).message}`);
      onError(err);
      if (currentUser.current) {
        try {
          await readProgress(currentUser.current);
        } catch (queryError) {
          setProgressError((queryError as Error).message);
        }
      }
    } finally {
      if (alive.current) setStarting(false);
    }
  };
  const item =
    user && profile?.user.id === user.id
      ? profile.items.find((x) => x.game === gameId)
      : undefined;
  const currentStart = user ? item?.nextStartLength : guestStarts[gameId];
  const direction = gameId === CORSI_FORWARD ? "正序" : "倒序";
  const retryProgress = () => {
    if (user)
      void readProgress(user).catch((err) => {
        setProgressError((err as Error).message);
        onError(err);
      });
  };
  const resetDialog = (
    <dialog
      ref={dialog}
      className="corsi-reset-dialog"
      aria-labelledby="corsi-reset-title"
    >
      <h2 id="corsi-reset-title">从 2 格重新开始？</h2>
      <p>
        仅恢复{direction}
        起点，历史和最佳成绩保留。其他设备重置前已开局的成绩仍可保存，但不会覆盖新起点。
      </p>
      <div className="corsi-actions">
        <form method="dialog">
          <button autoFocus className="secondary">
            取消
          </button>
        </form>
        <button
          type="button"
          className="primary"
          onClick={() => void confirmReset()}
        >
          确认恢复
        </button>
      </div>
    </dialog>
  );

  if (mode === "result" && outcome)
    return (
      <section className="result-page corsi-result">
        <div className="result-heading">
          <span className="eyebrow">{direction} · 顺序记忆</span>
          <h1 ref={terminalHeading} tabIndex={-1}>
            本局完成
          </h1>
          <p>本级两题均未通过，本题未复现成功。</p>
        </div>
        <div className="card result-card">
          <strong className="corsi-score" data-testid="corsi-score">
            {outcome.score > 0
              ? `${outcome.score} 格`
              : `未通过起始 ${outcome.summary.startLength} 格`}
          </strong>
          <p>
            起始 {outcome.summary.startLength} 格 · 首题答对最高长度{" "}
            {outcome.summary.maxFirstTryLength || "暂无"}
          </p>
          <p>本局建议起点：{nextCorsiStart(outcome.summary)} 格</p>
          {outcome.owner ? (
            <>
              <p data-testid="corsi-save-status" role="status">
                {saveStatus === "saving"
                  ? "正在保存…"
                  : saveStatus === "saved"
                    ? "成绩已保存"
                    : "保存失败，账号起点尚未更新"}
              </p>
              <p>开局账户：{outcome.owner.name}</p>
              {saveStatus === "saved" &&
                profile?.user.id === outcome.owner.id &&
                currentUser.current?.id === outcome.owner.id &&
                !progressError && (
                  <p>
                    账号当前起点：
                    {
                      profile.items.find((x) => x.game === gameId)
                        ?.nextStartLength
                    }{" "}
                    格
                    {profile.items.find((x) => x.game === gameId)
                      ?.progressEpoch !== outcome.payload?.progressEpoch
                      ? "（本局属于恢复前进度，仅保留记录）"
                      : ""}
                  </p>
                )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {saveStatus === "failed" && (
                <button
                  className="secondary"
                  onClick={() => void submit(outcome)}
                >
                  重试保存
                </button>
              )}
              {progressError && (
                <div className="error" role="alert">
                  <p>{progressError}</p>
                  <button className="secondary" onClick={retryProgress}>
                    重新读取起点
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>游客成绩不会上传，刷新后起点重置为 2 格。</p>
          )}
        </div>
        <div className="result-actions">
          <button className="primary" onClick={setup}>
            再练一局
          </button>
          {outcome.owner && (
            <button className="secondary" onClick={() => onRecords(gameId)}>
              查看个人记录
            </button>
          )}
        </div>
      </section>
    );

  if (mode === "aborted")
    return (
      <section className="card corsi-aborted">
        <h1 ref={terminalHeading} tabIndex={-1}>
          本局已作废
        </h1>
        <p className="warning" data-testid="corsi-abort" role="alert">
          {snapshot?.reason || error || "展示已中断"}。本局未计入，起点未改变。
        </p>
        <button className="primary" onClick={setup}>
          返回准备页
        </button>
        <button className="secondary" disabled={starting} onClick={openReset}>
          从 2 格重新开始
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {progressError && (
          <p className="error" role="alert">
            {progressError}
          </p>
        )}
        {resetDialog}
      </section>
    );

  if (mode === "running" && snapshot)
    return (
      <section className="play-page corsi-play">
        <div className="play-top">
          <span>
            {direction} · {snapshot.length} 格
          </span>
          <button className="text-button" onClick={abort}>
            结束本局
          </button>
        </div>
        <div className="play-title">
          <p data-testid="corsi-trial">第 {snapshot.trial} / 2 题</p>
          <h1 data-testid="corsi-phase">
            {snapshot.phase === "preparing"
              ? "正在准备序列"
              : snapshot.phase === "presenting"
                ? "请记忆"
                : snapshot.phase === "recalling"
                  ? `请按${direction}复现`
                  : "本题反馈"}
          </h1>
          {snapshot.phase === "presenting" && (
            <p>
              正在展示第{" "}
              <span data-testid="corsi-stimulus-step">
                {Math.floor(snapshot.slot / 2) + 1}
              </span>{" "}
              步
            </p>
          )}
          {snapshot.phase === "recalling" && (
            <p data-testid="corsi-entered">
              已输入 {snapshot.enteredCount} / {snapshot.length}
            </p>
          )}
        </div>
        <div
          className="board corsi-board"
          role="group"
          aria-label="顺序记忆棋盘"
          aria-busy={snapshot.phase === "preparing"}
        >
          {Array.from({ length: 9 }, (_, cell) => (
            <button
              key={cell}
              ref={cell === 0 ? firstCell : undefined}
              type="button"
              className={`cell corsi-cell${snapshot.cell === cell ? " lit" : ""}${pressed === cell ? " pressed" : ""}`}
              data-cell={cell}
              aria-label={`方块 ${cell + 1}`}
              disabled={snapshot.phase !== "recalling"}
              onKeyDown={(event) => {
                if (
                  event.repeat &&
                  (event.key === "Enter" || event.key === " ")
                )
                  event.preventDefault();
              }}
              onClick={() => respond(cell)}
            >
              {cell + 1}
            </button>
          ))}
        </div>
        {snapshot.phase === "preparing" && <p>正在准备，可随时结束本局。</p>}
        {snapshot.phase === "recalling" && (
          <>
            <p className="fine">
              点击方块或按数字键 1～9，不限时；点满后自动判定。
            </p>
            <button
              className="secondary"
              onClick={() => {
                engine.current?.giveUp(performance.now());
                publish();
              }}
            >
              记不住了
            </button>
          </>
        )}
        {snapshot.phase === "feedback" && (
          <div
            className="corsi-feedback"
            data-testid="corsi-feedback"
            role="status"
          >
            <h2>{snapshot.correct ? "本题正确" : "本题未答对"}</h2>
            <p>
              {snapshot.trial === 1
                ? "本级还有第二题。"
                : "本级已通过，下一题增加 1 格。"}
            </p>
            <button
              className="primary"
              ref={nextButton}
              onClick={() => void next()}
            >
              下一题
            </button>
          </div>
        )}
      </section>
    );

  return (
    <section className="corsi-setup">
      <div className="home-heading">
        <h1>顺序记忆 · Corsi 方块</h1>
        <p>记住亮起的路径，再按顺序复现。</p>
      </div>
      <div className="corsi-setup-grid">
        <section className="card corsi-rules">
          <h2>怎样练习</h2>
          <ol>
            <li>每格亮起 0.5 秒、留空 0.5 秒，展示结束后再作答。</li>
            <li>
              正序按原顺序点击；倒序从最后一格开始。点满次数自动判定，不能撤回。
            </li>
            <li>每个长度做两题，至少一题正确就增加 1 格，两题都错结束。</li>
          </ol>
          <p>序列允许隔位重复，相邻两步不同；作答不限时，可选“记不住了”。</p>
          <p>
            成绩记录最高通过长度。下局从上一局首题答对的最高长度起步；若开局首题失败，优先从本局起始长度减
            1 起步，最低 2 格。
          </p>
          <p className="fine">
            玩法长度不设固定上限。离开、切后台、锁屏、资源不足或漏展示会使整局作废，不改变起点。
          </p>
        </section>
        <section className="card corsi-options">
          <h2>选择方向</h2>
          <div className="mode-options" role="group" aria-label="训练方向">
            {CORSI_GAME_IDS.map((id) => (
              <button
                key={id}
                className={id === gameId ? "selected" : ""}
                aria-pressed={id === gameId}
                onClick={() => {
                  location.hash =
                    id === CORSI_FORWARD ? "corsi" : "corsi-backward";
                }}
              >
                {id === CORSI_FORWARD ? "正序" : "倒序"}
              </button>
            ))}
          </div>
          <div className="corsi-direction-overview">
            {CORSI_GAME_IDS.map((id) => {
              const p =
                profile?.user.id === user?.id
                  ? profile?.items.find((x) => x.game === id)
                  : undefined;
              return (
                <p key={id}>
                  {id === CORSI_FORWARD ? "正序" : "倒序"}：起点{" "}
                  {user ? (p?.nextStartLength ?? "待读取") : guestStarts[id]} 格
                  <span data-testid="corsi-direction-best">
                    最佳{" "}
                    {user
                      ? p?.bestSpan
                        ? `${p.bestSpan} 格`
                        : p
                          ? "暂无通过记录"
                          : "待读取"
                      : "登录后查看"}
                  </span>
                </p>
              );
            })}
          </div>
          <p data-testid="corsi-current-start">
            {direction}当前起点：{currentStart ?? "待读取"}
            {currentStart !== undefined ? " 格" : ""}
          </p>
          {progressError && (
            <div className="error" role="alert">
              <p>{progressError}</p>
              <button className="secondary" onClick={retryProgress}>
                重新读取起点
              </button>
            </div>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary start-session"
            disabled={starting || !user || offline}
            onClick={() => void start(false)}
          >
            {starting ? "正在准备…" : "开始本局"}
          </button>
          <button
            className="secondary corsi-guest-start"
            disabled={starting}
            onClick={() => void start(true)}
          >
            以游客身份练习
          </button>
          <p className="fine">
            {user
              ? "账号起点以服务器已保存的最近完整局为准。"
              : "游客起点只保留在当前页面，登录后不会补传。"}
          </p>
          <button
            className="text-button"
            disabled={starting}
            onClick={openReset}
          >
            从 2 格重新开始
          </button>
        </section>
      </div>
      {resetDialog}
    </section>
  );
}
