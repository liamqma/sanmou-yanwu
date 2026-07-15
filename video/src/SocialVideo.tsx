import type {CSSProperties, ReactNode} from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {content, getSceneDuration, hasAudio, totalDurationInFrames} from './Root';
import {colors, fonts, paperTexture, resolveAccent, shape, withAlpha} from './theme';
import type {ComparisonRow, VideoScene} from './types';

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const PAGE_PADDING = 96;

// --- Ambient layers -------------------------------------------------------

/** Paper background with a faint texture and thin framing rule. */
const Background: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: colors.paper}}>
    <AbsoluteFill style={{backgroundImage: paperTexture, opacity: 1}} />
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 12%, ${withAlpha(
          colors.paperLight,
          0.9,
        )}, transparent 55%)`,
      }}
    />
  </AbsoluteFill>
);

/** Series label + progress rule, matching the web's thin-rule aesthetic. */
const Chrome: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = frame / Math.max(1, totalDurationInFrames - 1);

  return (
    <AbsoluteFill style={{pointerEvents: 'none', fontFamily: fonts.body}}>
      <div
        style={{
          position: 'absolute',
          left: PAGE_PADDING,
          right: PAGE_PADDING,
          top: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: colors.textSecondary,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 4,
        }}
      >
        <span>{content.meta.series}</span>
        <span style={{fontVariantNumeric: 'tabular-nums'}}>
          {String(Math.min(99, Math.ceil(progress * 100))).padStart(2, '0')}
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: PAGE_PADDING,
          right: PAGE_PADDING,
          top: 92,
          height: 1,
          background: colors.rule,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: PAGE_PADDING,
          right: PAGE_PADDING,
          bottom: 60,
          height: 3,
          background: withAlpha(colors.ink, 0.08),
          overflow: 'hidden',
          borderRadius: shape.radiusSmall,
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: colors.seal,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// --- Shared primitives ----------------------------------------------------

const SceneShell: React.FC<{
  duration: number;
  accent: string;
  children: ReactNode;
  center?: boolean;
}> = ({duration, accent, children, center}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame, fps, config: {damping: 20, stiffness: 120, mass: 0.8}});
  const third = duration / 3;
  const fadeIn = Math.min(8, third);
  const fadeOut = Math.max(duration - 9, duration - third);
  const opacity = interpolate(frame, [0, fadeIn, fadeOut, duration], [0, 1, 1, 0], clamp);
  const lift = interpolate(enter, [0, 1], [32, 0], clamp);

  return (
    <AbsoluteFill
      style={{
        padding: `150px ${PAGE_PADDING}px 130px`,
        color: colors.textPrimary,
        fontFamily: fonts.body,
        opacity,
        transform: `translateY(${lift}px)`,
        justifyContent: center ? 'center' : 'flex-start',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: PAGE_PADDING,
          top: 124,
          width: 64,
          height: 4,
          borderRadius: shape.radiusSmall,
          background: accent,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

const Eyebrow: React.FC<{children: ReactNode; accent: string}> = ({children, accent}) => (
  <div
    style={{
      color: accent,
      fontSize: 26,
      fontWeight: 800,
      letterSpacing: 6,
      marginBottom: 22,
    }}
  >
    {children}
  </div>
);

const Title: React.FC<{children: ReactNode; size?: number}> = ({children, size = 84}) => (
  <div
    style={{
      fontFamily: fonts.heading,
      fontSize: size,
      fontWeight: 700,
      lineHeight: 1.16,
      letterSpacing: '0.01em',
      whiteSpace: 'pre-line',
      color: colors.ink,
    }}
  >
    {children}
  </div>
);

const Subtitle: React.FC<{children: ReactNode}> = ({children}) => (
  <div
    style={{
      marginTop: 26,
      fontSize: 34,
      lineHeight: 1.5,
      color: colors.textSecondary,
      whiteSpace: 'pre-line',
    }}
  >
    {children}
  </div>
);

const cardStyle: CSSProperties = {
  border: shape.border,
  borderRadius: shape.radius,
  background: colors.paperLight,
  boxShadow: shape.cardShadow,
};

const Caption: React.FC<{children: ReactNode; accent: string}> = ({children, accent}) => (
  <div
    style={{
      position: 'absolute',
      left: PAGE_PADDING,
      right: PAGE_PADDING,
      bottom: 96,
      padding: '24px 28px',
      background: colors.paperLight,
      border: shape.border,
      borderLeftWidth: 4,
      borderLeftColor: accent,
      borderRadius: shape.radiusSmall,
      fontSize: 30,
      fontWeight: 700,
      lineHeight: 1.45,
      color: colors.ink,
      boxShadow: shape.softShadow,
    }}
  >
    {children}
  </div>
);

const Tags: React.FC<{tags: string[]; accent: string}> = ({tags, accent}) => (
  <div style={{display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 40}}>
    {tags.map((tag, index) => (
      <div
        key={`${tag}-${index}`}
        style={{
          padding: '12px 20px',
          border: `1px solid ${withAlpha(accent, 0.42)}`,
          borderRadius: shape.radiusSmall,
          background: withAlpha(accent, 0.1),
          color: accent,
          fontSize: 24,
          fontWeight: 700,
        }}
      >
        {tag}
      </div>
    ))}
  </div>
);

const StatChips: React.FC<{stats: {label: string; value: string}[]}> = ({stats}) => (
  <div style={{display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 40}}>
    {stats.map((stat, index) => (
      <div key={`${stat.label}-${index}`} style={{...cardStyle, padding: '18px 24px', minWidth: 180}}>
        <div style={{fontSize: 22, color: colors.textSecondary, letterSpacing: 2}}>{stat.label}</div>
        <div style={{fontSize: 40, fontWeight: 750, color: colors.ink, marginTop: 6}}>{stat.value}</div>
      </div>
    ))}
  </div>
);

const BeforeAfterBlock: React.FC<{
  before: string;
  after: string;
  delta?: string;
  label?: string;
  accent: string;
}> = ({before, after, delta, label, accent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = spring({frame: frame - 6, fps, config: {damping: 16, stiffness: 150, mass: 0.7}});

  return (
    <div style={{marginTop: 44}}>
      {label ? (
        <div style={{fontSize: 24, color: colors.textSecondary, marginBottom: 14, letterSpacing: 2}}>
          {label}
        </div>
      ) : null}
      <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
        <div
          style={{
            ...cardStyle,
            padding: '18px 26px',
            fontSize: 40,
            fontWeight: 700,
            color: colors.textSecondary,
            textDecoration: 'line-through',
          }}
        >
          {before}
        </div>
        <div style={{fontSize: 40, color: colors.textSecondary}}>→</div>
        <div
          style={{
            padding: '18px 30px',
            borderRadius: shape.radius,
            background: accent,
            color: colors.paperLight,
            fontSize: 46,
            fontWeight: 750,
            transform: `scale(${interpolate(pop, [0, 1], [0.8, 1], clamp)})`,
            boxShadow: shape.cardShadow,
          }}
        >
          {after}
        </div>
        {delta ? (
          <div style={{fontSize: 28, fontWeight: 800, color: accent}}>{delta}</div>
        ) : null}
      </div>
    </div>
  );
};

const Bullets: React.FC<{bullets: string[]; accent: string}> = ({bullets, accent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <div style={{display: 'grid', gap: 16, marginTop: 44}}>
      {bullets.map((bullet, index) => {
        const p = spring({frame: frame - 10 - index * 6, fps, config: {damping: 18, stiffness: 125}});
        return (
          <div
            key={`${bullet}-${index}`}
            style={{
              ...cardStyle,
              display: 'grid',
              gridTemplateColumns: '44px 1fr',
              alignItems: 'start',
              gap: 18,
              padding: '22px 26px',
              fontSize: 30,
              fontWeight: 600,
              lineHeight: 1.45,
              color: colors.ink,
              transform: `translateY(${interpolate(p, [0, 1], [28, 0], clamp)}px)`,
              opacity: p,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: shape.radiusSmall,
                display: 'grid',
                placeItems: 'center',
                background: withAlpha(accent, 0.13),
                border: `1px solid ${withAlpha(accent, 0.42)}`,
                color: accent,
                fontSize: 20,
                fontWeight: 800,
              }}
            >
              {String(index + 1).padStart(2, '0')}
            </div>
            <span>{bullet}</span>
          </div>
        );
      })}
    </div>
  );
};

const RowList: React.FC<{rows: ComparisonRow[]; defaultAccent: string}> = ({rows, defaultAccent}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  return (
    <div style={{display: 'grid', gap: 16, marginTop: 44}}>
      {rows.map((row, index) => {
        const p = spring({frame: frame - index * 5, fps, config: {damping: 20, stiffness: 130}});
        const rowAccent = row.accent ? resolveAccent(row.accent) : defaultAccent;
        return (
          <div
            key={`${row.name}-${index}`}
            style={{
              ...cardStyle,
              display: 'grid',
              gridTemplateColumns: '1fr 120px 40px 120px 110px',
              alignItems: 'center',
              gap: 14,
              padding: '24px 26px',
              transform: `translateX(${interpolate(p, [0, 1], [60, 0], clamp)}px)`,
              opacity: p,
            }}
          >
            <span style={{fontSize: 34, fontWeight: 750, color: colors.ink}}>{row.name}</span>
            <span
              style={{
                fontSize: 30,
                color: colors.textSecondary,
                textDecoration: 'line-through',
                textAlign: 'center',
              }}
            >
              {row.before}
            </span>
            <span style={{fontSize: 28, color: colors.textSecondary, textAlign: 'center'}}>→</span>
            <span style={{fontSize: 36, fontWeight: 800, color: rowAccent, textAlign: 'center'}}>
              {row.after}
            </span>
            <span style={{fontSize: 24, fontWeight: 700, color: rowAccent, textAlign: 'center'}}>
              {row.delta ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// --- Scene layouts --------------------------------------------------------

const IntroScene: React.FC<{scene: VideoScene; duration: number; accent: string}> = ({
  scene,
  duration,
  accent,
}) => (
  <SceneShell duration={duration} accent={accent} center>
    {scene.eyebrow ? <Eyebrow accent={accent}>{scene.eyebrow}</Eyebrow> : null}
    {scene.title ? <Title size={96}>{scene.title}</Title> : null}
    {scene.subtitle ? <Subtitle>{scene.subtitle}</Subtitle> : null}
    {scene.tags?.length ? <Tags tags={scene.tags} accent={accent} /> : null}
    {scene.caption ? <Caption accent={accent}>{scene.caption}</Caption> : null}
  </SceneShell>
);

const ContentScene: React.FC<{scene: VideoScene; duration: number; accent: string}> = ({
  scene,
  duration,
  accent,
}) => (
  <SceneShell duration={duration} accent={accent}>
    <div style={{marginTop: 30}}>
      {scene.eyebrow ? <Eyebrow accent={accent}>{scene.eyebrow}</Eyebrow> : null}
      {scene.title ? <Title>{scene.title}</Title> : null}
      {scene.subtitle ? <Subtitle>{scene.subtitle}</Subtitle> : null}
      {scene.beforeAfter ? (
        <BeforeAfterBlock
          before={scene.beforeAfter.before}
          after={scene.beforeAfter.after}
          delta={scene.beforeAfter.delta}
          label={scene.beforeAfter.label}
          accent={accent}
        />
      ) : null}
      {scene.stats?.length ? <StatChips stats={scene.stats} /> : null}
      {scene.bullets?.length ? <Bullets bullets={scene.bullets} accent={accent} /> : null}
    </div>
    {scene.caption ? <Caption accent={accent}>{scene.caption}</Caption> : null}
  </SceneShell>
);

const ComparisonScene: React.FC<{scene: VideoScene; duration: number; accent: string}> = ({
  scene,
  duration,
  accent,
}) => (
  <SceneShell duration={duration} accent={accent}>
    <div style={{marginTop: 30}}>
      {scene.eyebrow ? <Eyebrow accent={accent}>{scene.eyebrow}</Eyebrow> : null}
      {scene.title ? <Title>{scene.title}</Title> : null}
      {scene.subtitle ? <Subtitle>{scene.subtitle}</Subtitle> : null}
      {scene.beforeAfter ? (
        <BeforeAfterBlock
          before={scene.beforeAfter.before}
          after={scene.beforeAfter.after}
          delta={scene.beforeAfter.delta}
          label={scene.beforeAfter.label}
          accent={accent}
        />
      ) : null}
      {scene.rows?.length ? <RowList rows={scene.rows} defaultAccent={accent} /> : null}
      {scene.stats?.length ? <StatChips stats={scene.stats} /> : null}
    </div>
    {scene.caption ? <Caption accent={accent}>{scene.caption}</Caption> : null}
  </SceneShell>
);

const OutroScene: React.FC<{scene: VideoScene; duration: number; accent: string}> = ({
  scene,
  duration,
  accent,
}) => (
  <SceneShell duration={duration} accent={accent} center>
    {scene.eyebrow ? <Eyebrow accent={accent}>{scene.eyebrow}</Eyebrow> : null}
    {scene.title ? <Title size={72}>{scene.title}</Title> : null}
    {scene.subtitle ? <Subtitle>{scene.subtitle}</Subtitle> : null}
    {scene.caption ? <Caption accent={accent}>{scene.caption}</Caption> : null}
  </SceneShell>
);

const Scene: React.FC<{scene: VideoScene; duration: number}> = ({scene, duration}) => {
  const accent = resolveAccent(scene.accent);
  switch (scene.kind) {
    case 'intro':
      return <IntroScene scene={scene} duration={duration} accent={accent} />;
    case 'outro':
      return <OutroScene scene={scene} duration={duration} accent={accent} />;
    case 'comparison':
    case 'summary':
      return <ComparisonScene scene={scene} duration={duration} accent={accent} />;
    case 'content':
    default:
      return <ContentScene scene={scene} duration={duration} accent={accent} />;
  }
};

export const SocialVideo: React.FC = () => {
  let offset = 0;

  return (
    <AbsoluteFill style={{backgroundColor: colors.paper}}>
      <Background />
      {content.scenes.map((scene) => {
        const duration = getSceneDuration(scene.id);
        const from = offset;
        offset += duration;

        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} name={scene.id}>
            <Scene scene={scene} duration={duration} />
            {hasAudio(scene.id) ? (
              <Audio src={staticFile(`audio/${scene.id}.mp3`)} volume={1} />
            ) : null}
          </Sequence>
        );
      })}
      <Chrome />
    </AbsoluteFill>
  );
};
