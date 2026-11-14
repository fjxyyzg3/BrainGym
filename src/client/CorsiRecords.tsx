import { useEffect, useState } from "react";
import { api } from "./api";
import {
  GAME_IDS,
  GAME_NAMES,
  type CorsiGameId,
  type GameId,
  type User,
  type CorsiHistory,
  type CorsiSavedResult,
} from "../shared/contracts";

export function CorsiRecords({
  gameId,
  user,
  revision,
  onGame,
  onTrain,
  onLogin,
  onError,
  onUser,
}: {
  gameId: CorsiGameId;
  user: User | null;
  revision: number;
  onGame: (game: GameId) => void;
  onTrain: (game: GameId) => void;
  onLogin: () => void;
  onError: (err: unknown) => void;
  onUser: (user: User) => void;
}) {
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CorsiHistory | null>(null),
    [best, setBest] = useState<CorsiSavedResult | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setPage(1);
    setHistory(null);
    setBest(null);
  }, [user?.id, gameId]);
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setBest(null);
    setError("");
    if (!user) return;
    setBusy(true);
    void Promise.all([
      api<CorsiHistory & { user: User }>(`history?page=${page}&game=${gameId}`),
      api<{ items: CorsiSavedResult[]; user: User }>(`bests?game=${gameId}`),
    ])
      .then(([h, b]) => {
        if (cancelled) return;
        if (h.user.id !== user.id || b.user.id !== user.id) {
          onUser(h.user);
          throw new Error("账户发生变化，请重新查看记录");
        }
        setHistory(h);
        setBest(b.items[0] ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          onError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, gameId, page, refresh, revision, onError, onUser]);
  return (
    <>
      <div className="records-title">
        <div>
          <h1>个人记录</h1>
          <p>分别观察正序与倒序的复现长度。</p>
        </div>
        {user && (
          <button className="secondary compact" onClick={() => onTrain(gameId)}>
            开始训练
          </button>
        )}
      </div>
      {!user ? (
        <section className="empty-state card">
          <h2>登录后查看个人记录</h2>
          <p>游客成绩不上传，登录后不会补传。</p>
          <button className="primary" onClick={onLogin}>
            Token 登录
          </button>
        </section>
      ) : (
        <>
          <div className="mode-options" role="group" aria-label="记录模式">
            {GAME_IDS.map((id) => (
              <button
                key={id}
                className={id === gameId ? "selected" : ""}
                aria-pressed={id === gameId}
                onClick={() => {
                  setPage(1);
                  onGame(id);
                }}
              >
                {GAME_NAMES[id]}
              </button>
            ))}
          </div>
          <div className="section-heading">
            <h2>最高通过长度</h2>
            <span>{GAME_NAMES[gameId]} · 历次最佳</span>
          </div>
          <section className="best-card corsi-best" data-testid="corsi-best">
            <span>{GAME_NAMES[gameId]}</span>
            <strong>
              {!history
                ? error
                  ? "读取失败"
                  : "正在读取…"
                : best
                  ? `${best.score} 格`
                  : "暂无通过记录"}
            </strong>
            <p>
              {best
                ? new Date(best.completedAt).toLocaleString("zh-CN")
                : "完整失败局保留历史，不计入最佳。"}
            </p>
          </section>
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
            <p className="card empty-row" role="status">
              正在读取记录…
            </p>
          ) : !history?.items.length ? (
            <div className="card empty-row">
              <p>还没有训练记录。</p>
              <button className="text-link" onClick={() => onTrain(gameId)}>
                开始第一局
              </button>
            </div>
          ) : (
            <>
              <div className="table-scroll card">
                <table>
                  <caption className="visually-hidden">
                    {GAME_NAMES[gameId]}训练历史
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "完成时间",
                        "起始长度",
                        "最高通过",
                        "首题答对最高长度",
                        "本局建议起点",
                      ].map((title) => (
                        <th key={title} scope="col">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.items.map((row) => (
                      <tr key={row.resultId}>
                        <td>
                          {new Date(row.completedAt).toLocaleString("zh-CN")}
                          {row.timeAnomaly && (
                            <small className="corsi-time-warning">
                              完成时间异常，不决定起点
                            </small>
                          )}
                        </td>
                        <td>{row.startLength} 格</td>
                        <td className="table-score">
                          {row.score > 0
                            ? `${row.score} 格`
                            : `未通过起始 ${row.startLength} 格`}
                        </td>
                        <td>
                          {row.maxFirstTryLength
                            ? `${row.maxFirstTryLength} 格`
                            : "暂无"}
                        </td>
                        <td>{row.nextStartLength} 格</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="fine">
                本局建议起点是当局推导值。恢复进度会保留这些历史与最佳；当前起点请在准备页查看。
              </p>
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
