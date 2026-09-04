import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useLocation } from 'react-router-dom';
import { DAILY_YANWU_CONFIG } from '../dailyYanwuConfig';
import {
  GAME_CARD_FALLBACK,
  gameAssetManifest,
  getGameAsset,
} from '../gameAssets';
import {
  dailyYanwuFixtureFromSearch,
  drawDailyYanwuHeroes,
} from '../services/dailyYanwuDraw';

export const DAILY_YANWU_FLIP_DURATION_MS = 620;
export const DAILY_YANWU_FLIP_STAGGER_MS = 120;
const DAILY_YANWU_REVEAL_BUFFER_MS = 80;

type DrawPhase = 'entry' | 'backs' | 'flipping' | 'revealed';
type HeroTrio = [string, string, string];

const useReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface HeroMiniCardProps {
  hero: string;
  shared?: boolean;
  selected?: boolean;
}

const HeroMiniCard = ({ hero, shared, selected }: HeroMiniCardProps) => {
  const asset = getGameAsset(hero, 'hero');
  return (
    <figure
      className="daily-yanwu-mini-card daily-yanwu-mini-card--hero"
      data-testid={
        shared
          ? 'daily-yanwu-shared-hero'
          : selected
            ? 'daily-yanwu-selected-hero'
            : undefined
      }
      aria-label={`${shared ? '固定公共' : '已抽取'}武将：${hero}`}
    >
      {shared && <span className="daily-yanwu-mini-card__badge">公共</span>}
      <img
        src={asset?.path ?? GAME_CARD_FALLBACK}
        alt={`${hero}武将卡`}
        width="161"
        height="248"
      />
    </figure>
  );
};

const EmptyHeroSlot = ({ index }: { index: number }) => (
  <div
    className="daily-yanwu-empty-slot"
    data-testid="daily-yanwu-empty-hero"
    role="img"
    aria-label={`待抽取武将槽 ${index + 1}`}
  >
    <span aria-hidden="true" className="daily-yanwu-empty-slot__mark">
      武
    </span>
    <span className="daily-yanwu-empty-slot__text">待揭晓</span>
  </div>
);

const TacticMiniCard = ({ tactic }: { tactic: string }) => {
  const asset = getGameAsset(tactic, 'tactic');
  return (
    <figure
      className="daily-yanwu-mini-card daily-yanwu-mini-card--tactic"
      data-testid="daily-yanwu-shared-tactic"
      aria-label={`公共战法：${tactic}`}
    >
      <img
        src={asset?.path ?? GAME_CARD_FALLBACK}
        alt={`${tactic}战法卡`}
        width="160"
        height="247"
      />
    </figure>
  );
};

interface DrawCardProps {
  hero: string;
  index: number;
  phase: DrawPhase;
}

const DrawCard = ({ hero, index, phase }: DrawCardProps) => {
  const asset = getGameAsset(hero, 'hero');
  const revealed = phase === 'revealed';
  const accessibleLabel =
    phase === 'backs'
      ? `未揭晓武将卡 ${index + 1}`
      : phase === 'flipping'
        ? `正在揭晓武将卡 ${index + 1}`
        : `抽取武将：${hero}`;

  return (
    <div
      className="daily-yanwu-draw-card"
      data-testid="daily-yanwu-draw-card"
      aria-label={accessibleLabel}
      style={
        {
          '--daily-yanwu-card-delay': `${index * DAILY_YANWU_FLIP_STAGGER_MS}ms`,
        } as CSSProperties
      }
    >
      <div className="daily-yanwu-draw-card__inner">
        <div className="daily-yanwu-draw-card__face daily-yanwu-draw-card__back">
          <img
            src="/game-assets/daily-yanwu/hero-card-back.svg"
            alt=""
            aria-hidden="true"
            width="320"
            height="496"
          />
        </div>
        <div
          className="daily-yanwu-draw-card__face daily-yanwu-draw-card__front"
          aria-hidden={!revealed}
        >
          <img
            src={asset?.path ?? GAME_CARD_FALLBACK}
            alt={revealed ? `${hero}武将卡` : ''}
            width="161"
            height="248"
          />
          <span className="daily-yanwu-draw-card__caption" aria-hidden="true">
            <strong>50</strong>
            {hero}
          </span>
        </div>
      </div>
    </div>
  );
};

const DailyYanwu = () => {
  const location = useLocation();
  const [phase, setPhase] = useState<DrawPhase>('entry');
  const [pendingHeroes, setPendingHeroes] = useState<HeroTrio | null>(null);
  const [confirmedHeroes, setConfirmedHeroes] = useState<HeroTrio | null>(null);
  const entryButtonRef = useRef<HTMLButtonElement>(null);
  const drawButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (phase === 'backs') drawButtonRef.current?.focus();
    if (phase === 'flipping') dialogRef.current?.focus();
    if (phase === 'revealed') confirmButtonRef.current?.focus();
  }, [phase]);

  const openDraw = () => {
    const fixture = dailyYanwuFixtureFromSearch(location.search);
    const heroes = Object.keys(gameAssetManifest.heroes);
    const drawnHeroes =
      fixture ??
      drawDailyYanwuHeroes({
        heroes,
        excludedHero: DAILY_YANWU_CONFIG.sharedHero,
      });
    setPendingHeroes(drawnHeroes);
    setPhase('backs');
  };

  const revealCards = () => {
    setPhase('flipping');
    const revealDelay = useReducedMotion()
      ? 30
      : DAILY_YANWU_FLIP_DURATION_MS +
        DAILY_YANWU_FLIP_STAGGER_MS * 2 +
        DAILY_YANWU_REVEAL_BUFFER_MS;
    revealTimerRef.current = setTimeout(() => {
      setPhase('revealed');
      revealTimerRef.current = null;
    }, revealDelay);
  };

  const confirmDraw = () => {
    if (!pendingHeroes) return;
    setConfirmedHeroes(pendingHeroes);
    setPhase('entry');
    requestAnimationFrame(() => entryButtonRef.current?.focus());
  };

  const keepDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    if (phase === 'backs') drawButtonRef.current?.focus();
    else if (phase === 'revealed') confirmButtonRef.current?.focus();
    else dialogRef.current?.focus();
  };

  const statusMessage =
    phase === 'backs'
      ? '三张武将卡已就位，可以抽取'
      : phase === 'flipping'
        ? '正在揭晓三名武将'
        : phase === 'revealed'
          ? `抽取完成：${pendingHeroes?.join('、') ?? ''}`
          : confirmedHeroes
            ? `已确认初始武将：${confirmedHeroes.join('、')}`
            : '每天演武初始阵容尚未抽取';

  return (
    <div
      className="daily-yanwu"
      data-testid="daily-yanwu-page"
      data-phase={phase}
      data-visual-audit-allow-dark="true"
    >
      <div
        className={`daily-yanwu__world ${
          phase === 'entry' ? '' : 'daily-yanwu__world--obscured'
        }`}
        aria-hidden={phase === 'entry' ? undefined : true}
      >
        <img
          className="daily-yanwu__backdrop"
          src="/game-assets/daily-yanwu/arena-backdrop.svg"
          alt=""
          aria-hidden="true"
          width="1440"
          height="810"
        />
        <div className="daily-yanwu__atmosphere" aria-hidden="true" />
        <div className="daily-yanwu__brand" aria-hidden="true">
          <span>每日</span>
          <strong>演武</strong>
        </div>

        <header className="daily-yanwu__arena-title">
          <span className="daily-yanwu__title-kicker" aria-hidden="true">
            武 · 道 · 争 · 锋
          </span>
          <h1>
            <span className="daily-yanwu-sr-only">每天演武</span>
            <span aria-hidden="true">演武大会</span>
          </h1>
          <span className="daily-yanwu__title-rule" aria-hidden="true" />
        </header>

        <section
          className="daily-yanwu__selection"
          aria-labelledby="daily-yanwu-selection-title"
        >
          <div className="daily-yanwu-section-title">
            <span aria-hidden="true" />
            <h2 id="daily-yanwu-selection-title">选择初始武将</h2>
            <span aria-hidden="true" />
          </div>

          <div className="daily-yanwu__roster-group">
            <div className="daily-yanwu__group-label">
              <h3>初始武将</h3>
              <span>共四名</span>
            </div>
            <div className="daily-yanwu__hero-grid">
              <HeroMiniCard hero={DAILY_YANWU_CONFIG.sharedHero} shared />
              {confirmedHeroes
                ? confirmedHeroes.map((hero) => (
                    <HeroMiniCard key={hero} hero={hero} selected />
                  ))
                : [0, 1, 2].map((index) => (
                    <EmptyHeroSlot key={index} index={index} />
                  ))}
            </div>
          </div>

          <div className="daily-yanwu__roster-group daily-yanwu__roster-group--tactics">
            <div className="daily-yanwu__group-label">
              <h3>公共战法</h3>
              <span>八选共用</span>
            </div>
            <div className="daily-yanwu__tactic-grid">
              {DAILY_YANWU_CONFIG.sharedTactics.map((tactic) => (
                <TacticMiniCard key={tactic} tactic={tactic} />
              ))}
            </div>
          </div>

          <button
            ref={entryButtonRef}
            className="daily-yanwu-button daily-yanwu-button--entry"
            type="button"
            onClick={openDraw}
          >
            <span aria-hidden="true">◆</span>
            {confirmedHeroes ? '重新抽取' : '抽取初始'}
            <span aria-hidden="true">◆</span>
          </button>
        </section>

        <p
          className="daily-yanwu__creator-note"
          data-visual-priority="tertiary"
        >
          做这个网页版演武，是因为游戏里一周只能玩一次，实在不过瘾。策划迟迟不推出每周双演武或演武天梯，所以决定自己做一个。当前还是半成品。
        </p>
      </div>

      {phase !== 'entry' && pendingHeroes && (
        <div className="daily-yanwu__veil">
          <div
            ref={dialogRef}
            className="daily-yanwu__draw-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-yanwu-draw-title"
            tabIndex={-1}
            onKeyDown={keepDialogFocus}
          >
            <div className="daily-yanwu-section-title daily-yanwu-section-title--draw">
              <span aria-hidden="true" />
              <h2 id="daily-yanwu-draw-title">抽取本期个人初始武将</h2>
              <span aria-hidden="true" />
            </div>
            <div
              className="daily-yanwu__draw-cards"
              data-testid="daily-yanwu-draw-cards"
            >
              {pendingHeroes.map((hero, index) => (
                <DrawCard
                  key={`${hero}-${index}`}
                  hero={hero}
                  index={index}
                  phase={phase}
                />
              ))}
            </div>
            {phase === 'backs' && (
              <button
                ref={drawButtonRef}
                className="daily-yanwu-button daily-yanwu-button--dialog"
                type="button"
                onClick={revealCards}
              >
                抽取
              </button>
            )}
            {phase === 'revealed' && (
              <button
                ref={confirmButtonRef}
                className="daily-yanwu-button daily-yanwu-button--dialog"
                type="button"
                onClick={confirmDraw}
              >
                确认
              </button>
            )}
          </div>
        </div>
      )}

      <p className="daily-yanwu-sr-only" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </p>
    </div>
  );
};

export default DailyYanwu;
