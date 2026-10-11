import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BoardState, GameMode } from '@kagaribi/core';
import { GAME_MODES, gameModeLabel } from '@kagaribi/core';
import { blindsUnresolved, withUserBlinds, type OcrReadout, type RawReads } from '@kagaribi/ocr';
import { backLayers } from './backLayers';
import { createBackController } from './navHistory';
import { buildBoardState, defaultForm, reconcilePositions, type BoardForm } from './formModel';
import { MAX_PLAYERS, solveOptsForN } from './solveLimits';
import { rasterPreviewUrl } from './ocr/decodeImage';
import { reprefillForGameMode } from './ocr/prefill';
import { prefillFromScreenshot, type OcrPrefillResult } from './ocr/screenshotPrefill';
import { evLossOf, finishRecord, headlineNode, startRecord, type HeroAction, type SpotRecord } from './records/model';
import { deleteRecord, listRecords, putRecord } from './records/store';
import { IDLE_JOB, canStartSolve, completeJob, createStartLatch, failJob, startJob, type SolveJob } from './solveJob';
import { solveInWorker } from './solverClient';
import { Confirm, type ModeNote } from './components/Confirm';
import { ErrorView } from './components/ErrorView';
import type { ChipMismatch } from './components/Confirm';
import { DEFAULT_GAME_SEL, selFromMode, selectedMode, type GameSel } from './components/GameModeSelect';
import { HelpModal, IcmInput } from './components/IcmInput';
import { InputForm } from './components/InputForm';
import { RecordsView } from './components/RecordsView';
import { Result } from './components/Result';
import { Toast } from './components/Toast';
import { FireBackground } from './components/FireBackground';
import { FlameMark, SunIcon } from './components/ui';
import { applyUpdate, onUpdateReady } from './pwaUpdate';

/** 画面。icm / history がタブ（ルート）、それ以外はそこから 1 段潜る。 */
type Screen = 'icm' | 'confirm' | 'error' | 'history' | 'result';
type Tab = 'icm' | 'history';

const tabOf = (s: Screen): Tab => (s === 'history' || s === 'result' ? 'history' : 'icm');
const depthOf = (s: Screen): number => (s === 'icm' ? 0 : s === 'history' ? 1 : s === 'result' ? 2 : 1);

interface ToastState {
  key: number;
  message: string;
  kind: 'done' | 'err';
  go?: string;
  onTap: () => void;
}

const DEFAULT_PLAYERS = 4;
const OVER_SCOPE_MSG = `現在は${MAX_PLAYERS}人までの局面に対応しています。`;
const GAME_MODE_KEY = 'kg-gameMode';
const THEME_KEY = 'kg-theme';

function loadGameSel(): GameSel {
  try {
    const saved = localStorage.getItem(GAME_MODE_KEY);
    if (saved && (GAME_MODES as readonly string[]).includes(saved)) return selFromMode(saved as GameMode);
  } catch {
    /* localStorage が使えなくても既定で動く。 */
  }
  return DEFAULT_GAME_SEL;
}

/** クリップボード／ドロップから画像ファイルを 1 枚取り出す。 */
function imageFrom(list: FileList | DataTransferItemList | null | undefined): File | null {
  if (!list) return null;
  for (const it of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const f = it instanceof File ? it : it.kind === 'file' ? it.getAsFile() : null;
    if (f && f.type.startsWith('image/')) return f;
  }
  return null;
}

export function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('icm');
  const [manualOpen, setManualOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [errFromPhoto, setErrFromPhoto] = useState(false);
  const [gameSel, setGameSel] = useState<GameSel>(loadGameSel);
  const gameMode = selectedMode(gameSel);

  const [form, setForm] = useState<BoardForm>(() => defaultForm(DEFAULT_PLAYERS, gameMode));
  const [state, setState] = useState<BoardState | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [lowConf, setLowConf] = useState<string[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrImageUrl, setOcrImageUrl] = useState<string | null>(null);
  const [readout, setReadout] = useState<OcrReadout | undefined>(undefined);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | undefined>(undefined);
  // OCR の生読み値。ゲームを切り替えたとき画像処理をやり直さず pipeline だけ再実行するために持つ。
  const [ocrReads, setOcrReads] = useState<RawReads | null>(null);
  // 読み取ったままの生読み値（手動の SB/BB を載せる前）と、手動で設定した BB（チップ）。
  // ヘッダのブラインドが読めなかった写真では、設定欄を出し続けて選び直し・取り消しができるようにする。
  const [ocrReadsBase, setOcrReadsBase] = useState<RawReads | null>(null);
  const [pickedBb, setPickedBb] = useState<number | null>(null);
  // 確認画面で利用者が値を手で直したか（直した後の切り替えでは値を上書きしない）。
  const [ocrEdited, setOcrEdited] = useState(false);
  const [modeMismatch, setModeMismatch] = useState<ChipMismatch>(null);
  const [modeNote, setModeNote] = useState<ModeNote>(null);
  const [stackRecovered, setStackRecovered] = useState(false);
  const [blurry, setBlurry] = useState(false);
  const [unresolvedStacks, setUnresolvedStacks] = useState<string[]>([]);

  const [records, setRecords] = useState<SpotRecord[]>([]);
  const [openRec, setOpenRec] = useState<SpotRecord | null>(null);
  // 計算ジョブ（App 直下に持つので画面を移っても止まらない）。同時に 1 件だけ。
  const [solveJob, setSolveJob] = useState<SolveJob>(IDLE_JOB);
  const startingRef = useRef(createStartLatch());
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dragging, setDragging] = useState(false);
  const jobRunning = solveJob.status === 'running';
  const closeToast = useCallback(() => setToast(null), []);

  function showToast(t: Omit<ToastState, 'key'>): void {
    setToast({ key: Date.now(), ...t });
  }

  async function refreshRecords(): Promise<void> {
    try {
      setRecords(await listRecords());
    } catch {
      /* IndexedDB が使えない環境では記録は空のまま。 */
    }
  }

  // 起動時: 前回の計算途中で閉じられた記録を「中断」に落としてから読み込む。
  useEffect(() => {
    void (async () => {
      try {
        const all = await listRecords();
        await Promise.all(all.filter((r) => r.status === 'solving').map((r) => putRecord({ ...r, status: 'aborted' })));
      } catch {
        /* noop */
      }
      await refreshRecords();
    })();
  }, []);

  // ---- ゲーム選択 ----
  function changeGameSel(next: GameSel): void {
    setGameSel(next);
    const mode = selectedMode(next);
    setForm((f) => ({ ...f, gameMode: mode }));
    setState((st) => (st ? { ...st, gameMode: mode } : st));
    try {
      localStorage.setItem(GAME_MODE_KEY, mode);
    } catch {
      /* 保存できなくても今回の選択は効く。 */
    }
    // 確認画面では生読み値で pipeline を再実行して警告・復元値を追従させる。
    if (screen === 'confirm' && ocrReads) applyOcrForMode(ocrReads, mode);
    else setModeNote(null);
  }

  /** 同じ生読み値を切り替え先のモードで通し直す。結果は必ず modeNote に一言で返す。 */
  function applyOcrForMode(reads: RawReads, mode: GameMode, force = false): { res: OcrPrefillResult; state?: BoardState } {
    const res = reprefillForGameMode(reads, mode, imageSize);
    const label = gameModeLabel(mode);
    setReadout(res.readout);
    if (!res.ok || !res.form) {
      setModeNote(
        res.issueCodes?.includes('not_club_match')
          ? { ok: false, text: `この写真は「${label}」としては読み取れませんでした。表示中の値は切り替える前のままです。` }
          : { ok: false, text: `「${label}」に切り替えましたが、まだ計算できません。${res.issues[0] ?? ''}` },
      );
      return { res };
    }
    setModeMismatch(res.chipTotals ?? null);
    setUnresolvedStacks(res.unresolvedStacks ?? []);
    if (ocrEdited && !force) {
      setModeNote({ ok: true, text: `「${label}」で計算します（手で直した値はそのまま使います）。` });
      return { res };
    }
    setStackRecovered(!!res.stackRecovered);
    // 読み直しても、選んであるレイズレンジの仮定は引き継ぐ。
    const nf = res.form.raiser ? { ...res.form, raiseRange: form.raiseRange } : res.form;
    setForm(nf);
    setLowConf(res.lowConfidenceFields);
    const built = buildBoardState(nf);
    if (built.ok && built.state) setState(built.state);
    setModeNote({ ok: true, text: `「${label}」として読み直しました。下の内容をご確認ください。` });
    return { res, state: built.ok ? built.state : undefined };
  }

  /** 「選んだゲームで読み直す」（確認画面・エラー画面）。受理できればそのまま確認画面へ。 */
  function rereadForSelectedMode(): void {
    if (!ocrReads) return;
    const { res, state: next } = applyOcrForMode(ocrReads, gameMode, true);
    if (!res.ok || !res.form || !next) {
      if (screen === 'error') {
        if (res.partialForm) setForm(res.partialForm);
        // ゲームのせいにするのは、チップの合計が選んだゲームと合わないときだけ（ハンドが読めない等は別の理由）。
        const gameIssue = res.issueCodes?.includes('not_club_match');
        setIssues(gameIssue ? [`この写真は「${gameModeLabel(gameMode)}」としては読み取れませんでした。`, ...res.issues] : res.issues);
      }
      return;
    }
    if (next.playersLeft > MAX_PLAYERS) {
      setIssues([OVER_SCOPE_MSG]);
      setScreen('error');
      return;
    }
    setOcrEdited(false);
    setScreen('confirm');
  }

  /**
   * ヘッダのブラインドが読めなかったとき、利用者が選んだ BB（チップ）で読み直す。総チップのチェックが
   * 効くようになる。合わなければ選び直せるよう、生読み値には載せずに元のまま残す。
   */
  function pickBlindBb(bb: number | null): void {
    if (!ocrReadsBase) return;
    const fromError = screen === 'error';
    const next = bb ? withUserBlinds(ocrReadsBase, bb) : ocrReadsBase;
    const label = bb ? `${bb / 2}/${bb}` : '';
    // 先に試し、読み直せないときは表示中の値も警告も変えない（選び直せるよう生読み値も元のまま）。
    const trial = reprefillForGameMode(next, gameMode, imageSize);
    if (!trial.ok || !trial.form) {
      const msg = bb ? `SB/BB ${label} では読み直せませんでした。` : 'SB/BB の設定を外すと読み直せませんでした。';
      setModeNote({ ok: false, text: `${msg}${trial.issues[0] ? `（${trial.issues[0]}）` : ''}` });
      if (fromError) setIssues([msg, ...trial.issues]);
      return;
    }
    const { state: st } = applyOcrForMode(next, gameMode, fromError);
    setOcrReads(next);
    setPickedBb(bb);
    setModeNote({
      ok: true,
      text: bb ? `SB/BB ${label} で確かめました。下の内容をご確認ください。` : 'SB/BB の設定を外しました（チップの合計のチェックは行いません）。',
    });
    if (!fromError || !st) return;
    if (st.playersLeft > MAX_PLAYERS) {
      setIssues([OVER_SCOPE_MSG]);
      return;
    }
    setOcrEdited(false);
    setScreen('confirm');
  }
  const blindPick = ocrReadsBase && blindsUnresolved(ocrReadsBase) ? pickBlindBb : undefined;

  // ---- 入力 ----
  function setOcrImage(url: string | null): void {
    setOcrImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }

  function startFreshManual(): void {
    setOcrImage(null);
    setReadout(undefined);
    setImageSize(undefined);
    setOcrReads(null);
    setOcrReadsBase(null);
    setPickedBb(null);
    setOcrEdited(false);
    setModeNote(null);
    setManualOpen(true);
  }

  function submitManual(f: BoardForm): void {
    setManualOpen(false);
    setOcrEdited(true);
    setLowConf([]);
    setModeNote(null);
    const built = buildBoardState(f);
    if (!built.ok || !built.state) {
      setErrFromPhoto(false);
      setIssues(built.issues);
      setScreen('error');
      return;
    }
    setState(built.state);
    setScreen('confirm');
  }

  async function onScreenshot(file: File): Promise<void> {
    if (ocrBusy || jobRunning) return;
    setOcrBusy(true);
    setErrFromPhoto(true);
    // 表示するのは描き直した画像だけ（選ばれたファイルそのものは表示しない。decodeImage.ts）。
    setOcrImage(await rasterPreviewUrl(file).catch(() => null));
    setReadout(undefined);
    setImageSize(undefined);
    setOcrReads(null);
    setOcrReadsBase(null);
    setPickedBb(null);
    setOcrEdited(false);
    setModeNote(null);
    try {
      const res = await prefillFromScreenshot(file, gameMode);
      setOcrReads(res.reads ?? null);
      setOcrReadsBase(res.reads ?? null);
      setPickedBb(null);
      setModeMismatch(res.chipTotals ?? null);
      setStackRecovered(!!res.stackRecovered);
      setBlurry(!!res.blurry);
      setUnresolvedStacks(res.unresolvedStacks ?? []);
      setReadout(res.readout);
      setImageSize(res.imageSize);
      if (!res.ok || !res.form) {
        // ハンド以外は読めたときは、「読めた分を手で埋める」でその値が入るようにする。
        if (res.partialForm) setForm(res.partialForm);
        setIssues(['スクリーンショットから局面を読み取れませんでした（対象はプリフロップの画面）。', ...res.issues]);
        setScreen('error');
        return;
      }
      setForm(res.form);
      const built = buildBoardState(res.form);
      if (!built.ok || !built.state) {
        setIssues(['読み取り結果の組み立てに失敗しました。手入力で修正してください。', ...built.issues]);
        setScreen('error');
        return;
      }
      if (built.state.playersLeft > MAX_PLAYERS) {
        setIssues([OVER_SCOPE_MSG]);
        setScreen('error');
        return;
      }
      setLowConf(res.lowConfidenceFields);
      setState(built.state);
      setScreen('confirm');
    } catch (e) {
      console.error(e);
      setIssues(['スクリーンショットの読み込みに失敗しました。', e instanceof Error ? e.message : String(e)]);
      setScreen('error');
    } finally {
      setOcrBusy(false);
    }
  }

  // ---- 計算 ----
  /** Worker で解いて記録を確定させる（新規・再計算の共通経路）。 */
  async function runSolve(rec: SpotRecord): Promise<void> {
    try {
      const { result, ms } = await solveInWorker(rec.state, solveOptsForN(rec.state.playersLeft));
      const finished = finishRecord(rec, { result, ms });
      await putRecord(finished).catch(() => undefined);
      await refreshRecords();
      setSolveJob((j) => (j.recordId === rec.id ? completeJob(j) : j));
      showToast({ message: '計算が完了しました', kind: 'done', go: 'OPEN', onTap: () => openRecord(finished) });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      await putRecord({ ...rec, status: 'failed', error: message }).catch(() => undefined);
      await refreshRecords();
      setSolveJob((j) => (j.recordId === rec.id ? failJob(j) : j));
      showToast({ message: '計算に失敗しました', kind: 'err', go: 'RECORDS', onTap: () => setScreen('history') });
    }
  }

  /** 「計算する」。記録を 1 件作って記録タブへ移り、計算はバックグラウンドで続ける。 */
  async function solve(): Promise<void> {
    if (!state || !canStartSolve(solveJob)) return;
    if (!startingRef.current.acquire()) return; // 連打対策の同期ラッチ。
    let handedOff = false;
    try {
      if (state.playersLeft > MAX_PLAYERS) {
        setErrFromPhoto(false);
        setIssues([OVER_SCOPE_MSG]);
        setScreen('error');
        return;
      }
      const rec = startRecord({
        clientId: crypto.randomUUID(),
        state,
        heroHand: state.heroHand,
        heroPos: state.heroPos,
        playersLeft: state.playersLeft,
      });
      await putRecord(rec).catch(() => undefined);
      await refreshRecords();
      setSolveJob(startJob(rec.id));
      setScreen('history');
      handedOff = true;
      void runSolve(rec).finally(() => startingRef.current.release());
    } finally {
      if (!handedOff) startingRef.current.release();
    }
  }

  async function onRetryRecord(rec: SpotRecord): Promise<void> {
    if (!canStartSolve(solveJob) || !startingRef.current.acquire()) return;
    let handedOff = false;
    try {
      const restarted: SpotRecord = { ...rec, status: 'solving', error: undefined, result: null };
      await putRecord(restarted).catch(() => undefined);
      await refreshRecords();
      setSolveJob(startJob(restarted.id));
      handedOff = true;
      void runSolve(restarted).finally(() => startingRef.current.release());
    } finally {
      if (!handedOff) startingRef.current.release();
    }
  }

  // ---- 記録 ----
  function openRecord(rec: SpotRecord): void {
    if (rec.status !== 'done' || !rec.result) return;
    setOpenRec(rec);
    setScreen('result');
  }

  async function onSelectAction(rec: SpotRecord, action: HeroAction | null): Promise<void> {
    const head = rec.result ? headlineNode(rec.result) : null;
    const evLoss = action != null && head ? evLossOf(head.heroEv, action) : null;
    const updated: SpotRecord = { ...rec, heroAction: action, evLoss };
    await putRecord(updated);
    setOpenRec(updated);
    await refreshRecords();
  }

  async function onDeleteRecord(rec: SpotRecord): Promise<void> {
    await deleteRecord(rec.id).catch(() => undefined);
    await refreshRecords();
  }

  function navTab(t: Tab): void {
    if (t === 'history') void refreshRecords();
    setScreen(t);
  }

  // ---- 端末の戻る（Android 等）: 重なり → 画面の順に 1 段戻す ----
  function stepBack(): void {
    if (backLayers.closeTop()) return;
    if (screen === 'confirm' || screen === 'error') setScreen('icm');
    else if (screen === 'result') setScreen('history');
    else if (screen === 'history') setScreen('icm');
  }
  const stepBackRef = useRef(stepBack);
  stepBackRef.current = stepBack;
  const layerCount = useSyncExternalStore(backLayers.subscribe, backLayers.getCount, backLayers.getCount);
  const navDepth = depthOf(screen) + layerCount;
  const backCtl = useRef<ReturnType<typeof createBackController> | null>(null);
  useEffect(() => {
    const ctl = createBackController(window.history);
    backCtl.current = ctl;
    const onPop = (): void => {
      if (ctl.handlePop()) stepBackRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      backCtl.current = null;
    };
  }, []);
  useEffect(() => {
    backCtl.current?.sync(navDepth);
  }, [navDepth]);

  // 画面を切り替えたら先頭から見せる。
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  // ---- 貼り付け・ドラッグ＆ドロップ（PC） ----
  const acceptRef = useRef<(f: File) => void>(() => undefined);
  acceptRef.current = (f: File) => {
    if (manualOpen || layerCount > 0 || ocrBusy || jobRunning) return;
    void onScreenshot(f);
  };
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onPaste = (e: ClipboardEvent): void => {
      const f = imageFrom(e.clipboardData?.items);
      if (f) {
        e.preventDefault();
        acceptRef.current(f);
      }
    };
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = imageFrom(e.dataTransfer?.files);
      if (f) acceptRef.current(f);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // ---- アプリ更新（PWA）: 手が空いているときに裏へ回ったら入れ替える。使用中はお知らせだけ ----
  const idle = (screen === 'icm' || screen === 'history') && !manualOpen && layerCount === 0 && !ocrBusy && !jobRunning;
  const idleRef = useRef(idle);
  idleRef.current = idle;
  useEffect(
    () =>
      onUpdateReady(() => {
        showToast({ message: '新しいバージョンがあります', kind: 'done', go: 'UPDATE', onTap: applyUpdate });
        const onHide = (): void => {
          if (document.visibilityState === 'hidden' && idleRef.current) applyUpdate();
        };
        document.addEventListener('visibilitychange', onHide);
      }),
    [],
  );

  function toggleTheme(e: React.MouseEvent<HTMLButtonElement>): void {
    const r = document.documentElement;
    const cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    r.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* noop */
    }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      e.currentTarget.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], {
        duration: 500,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      });
    }
  }

  const tab = tabOf(screen);

  return (
    <>
    <FireBackground />
    <div className="app">
      <header className="top">
        <div className="brand">
          <FlameMark />
          <span>Kagaribi ICM</span>
        </div>
        <nav className="navpill" aria-label="タブ">
          <button type="button" className="nbtn" aria-current={tab === 'icm' ? 'page' : undefined} onClick={() => navTab('icm')}>
            ICM
          </button>
          <button
            type="button"
            className="nbtn"
            aria-current={tab === 'history' ? 'page' : undefined}
            onClick={() => navTab('history')}
          >
            記録
            {jobRunning && <i className="badge" aria-label="計算中" />}
          </button>
        </nav>
        <div className="top-r">
          <button type="button" className="hbtn" aria-label="使い方と読み取れる条件" onClick={() => setHelpOpen(true)}>
            <span className="q">?</span>
          </button>
          <button type="button" className="theme-toggle" aria-label="表示テーマを切り替える" onClick={toggleTheme}>
            <SunIcon />
          </button>
        </div>
      </header>

      <main className="main" ref={mainRef}>
        {screen === 'icm' && (
          <IcmInput
            onScreenshot={(f) => void onScreenshot(f)}
            onManual={startFreshManual}
            ocrBusy={ocrBusy}
            blocked={jobRunning}
            gameSel={gameSel}
            onGameModeChange={changeGameSel}
            onHelp={() => setHelpOpen(true)}
          />
        )}

        {screen === 'confirm' && state && (
          <Confirm
            state={state}
            lowConfidenceFields={lowConf}
            imageUrl={ocrImageUrl}
            readout={readout}
            onBack={() => setScreen('icm')}
            onEdit={() => setManualOpen(true)}
            onFixPlayers={(n) => {
              // 写真で席を取りこぼすと人数が少なく出る。選び直すと席を補う（補った席は要確認）。
              setOcrEdited(true);
              const nf = reconcilePositions({ ...form, playersLeft: n });
              setForm(nf);
              const built = buildBoardState(nf);
              if (built.ok && built.state) setState(built.state);
            }}
            gameSel={gameSel}
            onGameModeChange={changeGameSel}
            onReread={ocrReads ? rereadForSelectedMode : undefined}
            onPickBb={blindPick}
            pickedBb={pickedBb}
            modeNote={modeNote}
            modeMismatch={modeMismatch}
            stackRecovered={stackRecovered}
            blurry={blurry}
            unresolvedStacks={unresolvedStacks.filter((p) => state.seats.some((s) => s.pos === p && s.stack === 0))}
            blocked={jobRunning}
            onSolve={() => void solve()}
            onRaiseRange={
              state.raiseTo !== undefined
                ? (pct) => {
                    const nf = { ...form, raiseRange: pct === null ? '' : String(pct) };
                    setForm(nf);
                    const built = buildBoardState(nf);
                    if (built.ok && built.state) setState(built.state);
                  }
                : undefined
            }
          />
        )}

        {screen === 'error' && (
          <ErrorView
            issues={issues}
            onBack={() => setScreen('icm')}
            onManual={() => setManualOpen(true)}
            onRetry={errFromPhoto ? () => setScreen('icm') : undefined}
            imageUrl={ocrImageUrl ?? undefined}
            readout={readout}
            gameSel={errFromPhoto && ocrReads ? gameSel : undefined}
            onGameModeChange={errFromPhoto && ocrReads ? changeGameSel : undefined}
            onReread={errFromPhoto && ocrReads ? rereadForSelectedMode : undefined}
            onPickBb={errFromPhoto ? blindPick : undefined}
            pickedBb={pickedBb}
            modeNote={modeNote}
          />
        )}

        {screen === 'history' && (
          <RecordsView
            records={records}
            onOpen={openRecord}
            onDelete={(r) => void onDeleteRecord(r)}
            onRetry={(r) => void onRetryRecord(r)}
            jobRunning={jobRunning}
            onGoIcm={() => setScreen('icm')}
          />
        )}

        {screen === 'result' && openRec?.result && (
          <Result
            key={openRec.id}
            state={openRec.state}
            result={openRec.result}
            ms={openRec.ms}
            heroAction={openRec.heroAction}
            onSelectAction={(a) => onSelectAction(openRec, a)}
            onBack={() => setScreen('history')}
          />
        )}
      </main>

      {(screen === 'icm' || screen === 'history') && (
        <footer className="foot">
          <span>画像の解析と計算はこの端末内で完結します。記録はこの端末に保存されます。</span>
        </footer>
      )}

      {manualOpen && (
        <InputForm
          form={form}
          onFormChange={setForm}
          onSubmit={submitManual}
          imageUrl={ocrImageUrl}
          readout={readout}
          onClose={() => setManualOpen(false)}
        />
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          kind={toast.kind}
          go={toast.go}
          onTap={toast.onTap}
          onClose={closeToast}
        />
      )}

      {dragging && (
        <div className="drop">
          <span className="eyebrow">DROP SCREENSHOT</span>
        </div>
      )}
    </div>
    </>
  );
}
