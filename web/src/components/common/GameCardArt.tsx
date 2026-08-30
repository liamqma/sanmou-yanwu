import { useState } from 'react';
import { Box, Chip, IconButton, Typography, type SxProps, type Theme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { GAME_CARD_FALLBACK, getGameAsset, type GameAssetKind } from '../../gameAssets';

interface GameCardArtProps {
  name: string;
  kind: GameAssetKind;
  size?: 'mini' | 'compact' | 'full';
  selected?: boolean;
  recommended?: boolean;
  disabled?: boolean;
  support?: boolean;
  ranking?: string | null;
  onRemove?: () => void;
  artOnly?: boolean;
  sx?: SxProps<Theme>;
}

const qualityLabel = (quality?: string) => quality === 'purple' ? '紫色战法' : quality === 'orange' ? '橙色品质' : '卡面暂缺';

/** Local, manifest-backed card art with a text-preserving missing-image fallback. */
const GameCardArt = ({
  name,
  kind,
  size = 'full',
  selected = false,
  recommended = false,
  disabled = false,
  support = false,
  ranking,
  onRemove,
  artOnly = false,
  sx,
}: GameCardArtProps) => {
  const entry = getGameAsset(name, kind);
  const [failed, setFailed] = useState(false);
  const fallback = failed || !entry;
  const isMini = size === 'mini';
  const isCompact = size === 'compact';
  const showTextOverlay = !artOnly && (!isMini || fallback);

  return (
    <Box
      data-testid={`game-card-${kind}-${name}`}
      data-card-fallback={fallback ? 'true' : 'false'}
      data-card-quality={entry?.quality}
      data-card-size={size}
      sx={{
        position: 'relative',
        isolation: 'isolate',
        overflow: 'hidden',
        minWidth: 0,
        width: '100%',
        height: 'auto',
        aspectRatio: '160 / 248',
        border: '1px solid',
        borderColor: selected ? 'success.light' : recommended ? 'warning.main' : entry?.quality === 'purple' ? '#8c67bf' : 'secondary.main',
        borderRadius: 1,
        bgcolor: '#101716',
        boxShadow: selected
          ? '0 0 0 2px #78a892, 0 10px 24px rgba(0,0,0,.35)'
          : recommended
            ? '0 0 0 2px #d49a42, 0 12px 28px rgba(218,101,31,.2)'
            : '0 8px 20px rgba(0,0,0,.3)',
        opacity: disabled ? 0.48 : 1,
        filter: disabled ? 'grayscale(.7)' : 'none',
        ...sx,
      }}
    >
      <img
        src={fallback ? GAME_CARD_FALLBACK : entry.path}
        alt={`${name}${kind === 'hero' ? '武将' : '战法'}卡面${fallback ? '（暂缺）' : ''}`}
        loading="lazy"
        width={160}
        height={248}
        onError={() => setFailed(true)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          // The source assets are complete portrait cards. Contain guarantees
          // compact contexts never turn them into cropped landscape strips.
          objectFit: 'contain',
          objectPosition: 'center top',
        }}
      />
      {showTextOverlay && <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          background: isMini
            ? 'linear-gradient(180deg, transparent 48%, rgba(7,11,10,.94) 100%)'
            : 'linear-gradient(180deg, transparent 45%, rgba(8,13,12,.45) 64%, rgba(7,11,10,.96) 100%)',
          zIndex: 1,
        }}
      />}
      {showTextOverlay && <Box
        sx={{
          position: 'absolute',
          zIndex: 2,
          left: isMini ? 5 : 7,
          right: onRemove ? 38 : 7,
          bottom: isMini ? 5 : 7,
          minWidth: 0,
        }}
      >
        <Typography
          component="span"
          sx={{
            display: 'block',
            color: '#fff8e8',
            fontFamily: '"Songti SC", STSong, serif',
            fontSize: isMini ? 12 : isCompact ? 13 : { xs: 15, sm: 16 },
            fontWeight: 900,
            lineHeight: 1.2,
            textShadow: '0 1px 3px #000',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Typography>
        {!isCompact && !isMini && (
          <Typography component="span" sx={{ display: 'block', mt: 0.25, color: '#cbb994', fontSize: 10 }}>
            {ranking || (fallback ? '本地卡面暂缺' : qualityLabel(entry?.quality))}
          </Typography>
        )}
      </Box>}
      {!artOnly && (recommended || selected || support) && !isMini && (
        <Chip
          size="small"
          label={selected ? '✓ 已选择' : recommended ? '★ 推荐' : '支援'}
          color={selected ? 'success' : recommended ? 'warning' : 'info'}
          sx={{ position: 'absolute', zIndex: 3, top: 6, left: 6, height: 23, fontSize: 11 }}
        />
      )}
      {!artOnly && onRemove && (
        <IconButton
          size="small"
          aria-label={`移除${name}`}
          onClick={onRemove}
          sx={{
            position: 'absolute',
            zIndex: 4,
            top: 4,
            right: 4,
            width: 32,
            height: 32,
            minWidth: 32,
            minHeight: 32,
            color: '#fff',
            bgcolor: 'rgba(8,12,11,.78)',
            '&:hover': { bgcolor: 'rgba(127,45,28,.95)' },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
};

export default GameCardArt;
