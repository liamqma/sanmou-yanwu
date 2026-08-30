import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  List,
  ListItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import SportsEsportsOutlinedIcon from '@mui/icons-material/SportsEsportsOutlined';
import { useNavigate } from 'react-router-dom';
import { fetchUploadLeaderboard } from '../../services/uploadLeaderboard';
import type { UploadLeaderboardData } from '../../types/battleUpload';
import GameLoadingPanel from '../common/GameLoadingPanel';

interface LeaderboardPanelProps {
  titleId: string;
  data: UploadLeaderboardData | null;
  loading: boolean;
  failed: boolean;
  onContribute: () => void;
  onBackToAdvisor: () => void;
}

const updatedLabel = (value: string | null): string =>
  value === null ? '尚待首次每日更新' : `更新至 ${value}`;

const LeaderboardPanel = ({
  titleId,
  data,
  loading,
  failed,
  onContribute,
  onBackToAdvisor,
}: LeaderboardPanelProps) => (
  <Paper
    component="section"
    aria-labelledby={titleId}
    sx={{ p: { xs: 2, sm: 3 }, overflow: 'hidden' }}
  >
    <Stack direction="row" alignItems="center" gap={1}>
      <EmojiEventsOutlinedIcon color="secondary" />
      <Typography
        id={titleId}
        component="h2"
        variant="h6"
      >
        贡献者排名
      </Typography>
    </Stack>

    {loading && (
      <GameLoadingPanel
        label="正在加载战报贡献榜"
        detail="正在誊录今日战功…"
        variant="inline"
      />
    )}

    {!loading && failed && (
      <Alert severity="info" sx={{ my: 2 }}>
        贡献榜暂时无法加载，仍可正常上传战报。
      </Alert>
    )}

    {!loading && !failed && data && (
      <>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {updatedLabel(data.updated_date)}
        </Typography>
        <Typography variant="body2" fontWeight={700} sx={{ mt: 0.5 }}>
          已收录 {data.summary.accepted_reports} 份有效战报
        </Typography>
        <Divider sx={{ my: 1.5 }} />

        {data.contributors.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            还没有具名贡献者，等你来占据榜首。
          </Typography>
        ) : (
          <List
            component="ol"
            aria-label="战报贡献者排名"
            disablePadding
          >
            {data.contributors.map((contributor, index) => (
              <ListItem
                component="li"
                key={`${contributor.name}-${index}`}
                disableGutters
                divider={index < data.contributors.length - 1}
                sx={{ py: 0.75 }}
              >
                <Typography
                  aria-hidden="true"
                  sx={{ width: 28, flexShrink: 0, fontWeight: 800 }}
                >
                  {index + 1}
                </Typography>
                <Typography
                  title={contributor.name}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    fontWeight: 650,
                    whiteSpace: 'pre',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {contributor.name}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ ml: 1, whiteSpace: 'nowrap' }}
                >
                  {contributor.accepted_reports} 份
                </Typography>
              </ListItem>
            ))}
          </List>
        )}
      </>
    )}

    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      gap={1.5}
      sx={{ mt: 2 }}
    >
      <Button
        variant="contained"
        startIcon={<UploadFileOutlinedIcon />}
        onClick={onContribute}
      >
        上传我的战报
      </Button>
      <Button
        variant="outlined"
        startIcon={<SportsEsportsOutlinedIcon />}
        onClick={onBackToAdvisor}
      >
        返回对局推荐
      </Button>
    </Stack>
  </Paper>
);

const UploadLeaderboard = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<UploadLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchUploadLeaderboard(fetch, controller.signal)
      .then((result) => {
        setData(result);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <LeaderboardPanel
      titleId="upload-leaderboard-title"
      data={data}
      loading={loading}
      failed={failed}
      onContribute={() => navigate('/contribute')}
      onBackToAdvisor={() => navigate('/')}
    />
  );
};

export default UploadLeaderboard;
