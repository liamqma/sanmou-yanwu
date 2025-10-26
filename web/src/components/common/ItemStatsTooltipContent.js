import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, CircularProgress, Divider } from '@mui/material';
import { api } from '../../services/api';

/**
 * Tooltip content showing statistics for a hero or skill
 * Designed to be compact and readable in a tooltip
 */
const ItemStatsTooltipContent = ({ itemName, itemType, currentHeroes = [], currentSkills = [] }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);

  // Stabilize the arrays by converting to strings for comparison
  const heroesKey = useMemo(() => currentHeroes.join(','), [currentHeroes]);
  const skillsKey = useMemo(() => currentSkills.join(','), [currentSkills]);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getItemStats(itemName, itemType, currentHeroes, currentSkills);
      setStats(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (itemName && itemType) {
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemName, itemType, heroesKey, skillsKey]);

  const formatPercentage = (value) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
        <CircularProgress size={16} sx={{ color: 'white' }} />
        <Typography variant="body2">Loading...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 1 }}>
        <Typography variant="body2" color="error.light">
          {error}
        </Typography>
      </Box>
    );
  }

  if (!stats) {
    return null;
  }

  const getWinRateEmoji = (winRate) => {
    if (winRate >= 0.55) return '🔥';
    if (winRate >= 0.45) return '⚖️';
    return '❄️';
  };

  return (
    <Box sx={{ p: 1, maxWidth: 300 }}>
      {/* Item Name */}
      <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
        {itemName}
      </Typography>
      
      {/* Overall Stats */}
      <Box sx={{ mb: 1 }}>
        <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {getWinRateEmoji(stats.win_rate)} Win Rate: <strong>{formatPercentage(stats.win_rate)}</strong>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {stats.wins}W - {stats.losses}L ({stats.total_games} games)
        </Typography>
      </Box>

      {/* Current Team Synergies for Heroes */}
      {itemType === 'hero' && stats.current_team_synergies && stats.current_team_synergies.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>
            Win Rate with Chosen Heroes:
          </Typography>
          <Box sx={{ maxHeight: 120, overflow: 'auto' }}>
            {stats.current_team_synergies.map((synergy, idx) => (
              <Typography key={idx} variant="caption" display="block" sx={{ py: 0.25 }}>
                {getWinRateEmoji(synergy.win_rate)} with {synergy.hero}: {formatPercentage(synergy.win_rate)}
              </Typography>
            ))}
          </Box>
        </>
      )}

      {/* Skill Synergies */}
      {itemType === 'skill' && (
        <>
          {/* Current Team Synergies for Skills - with chosen skills */}
          {stats.current_skill_synergies && stats.current_skill_synergies.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>
                Win Rate with Chosen Skills:
              </Typography>
              <Box sx={{ maxHeight: 100, overflow: 'auto' }}>
                {stats.current_skill_synergies.map((synergy, idx) => (
                  <Typography key={idx} variant="caption" display="block" sx={{ py: 0.25 }}>
                    {getWinRateEmoji(synergy.win_rate)} with {synergy.skill}: {formatPercentage(synergy.win_rate)}
                  </Typography>
                ))}
              </Box>
            </>
          )}

          {/* Current Team Synergies for Skills - with chosen heroes */}
          {stats.current_hero_synergies && stats.current_hero_synergies.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="caption" fontWeight="bold" display="block" gutterBottom>
                Win Rate with Chosen Heroes:
              </Typography>
              <Box sx={{ maxHeight: 100, overflow: 'auto' }}>
                {stats.current_hero_synergies.map((synergy, idx) => (
                  <Typography key={idx} variant="caption" display="block" sx={{ py: 0.25 }}>
                    {getWinRateEmoji(synergy.win_rate)} with {synergy.hero}: {formatPercentage(synergy.win_rate)}
                  </Typography>
                ))}
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default React.memo(ItemStatsTooltipContent);
