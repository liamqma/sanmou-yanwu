import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { database, recommendationData } from '../data';
import { copyToClipboard } from '../utils/clipboard';
import { buildDeepSeekBattlePrompt } from '../services/battleUploadPrompt';
import {
  prefillBattleConfirmation,
  validateBattleConfirmation,
  validateBattlePaste,
} from '../services/battleUploadValidation';
import {
  getPersistentSubmissionId,
  submitBattle,
} from '../services/battleUploadApi';
import {
  loadUploaderName,
  saveUploaderName,
  validateUploaderName,
} from '../utils/uploaderName';
import { compareBattleStrength } from '../services/battleStrength';
import BattleLineup from '../components/contribute/BattleLineup';
import BattleStrengthNotice from '../components/contribute/BattleStrengthNotice';
import BattleConfirmationForm from '../components/contribute/BattleConfirmationForm';
import ResponsiveDisclosure from '../components/common/ResponsiveDisclosure';
import {
  loadContributionSeason,
  maxCatalogSeason,
  saveContributionSeason,
} from '../utils/contributionSeason';
import {
  emptyBattleConfirmation,
} from '../services/battleConfirmation';
import type { BattleConfirmation } from '../types/battleUpload';

const maximumContributionSeason = maxCatalogSeason(database);

const Contribute = () => {
  const prompt = useMemo(() => buildDeepSeekBattlePrompt(database), []);
  const [uploaderName, setUploaderName] = useState('');
  const [contributionSeason, setContributionSeason] = useState(
    maximumContributionSeason
  );
  const [paste, setPaste] = useState('');
  const [confirmation, setConfirmation] = useState(() =>
    emptyBattleConfirmation()
  );
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setUploaderName(loadUploaderName());
    setContributionSeason(
      loadContributionSeason(maximumContributionSeason)
    );
  }, []);

  const nameValidation = useMemo(
    () => validateUploaderName(uploaderName),
    [uploaderName]
  );
  const pasteValidation = useMemo(
    () => validateBattlePaste(paste, database),
    [paste]
  );
  const pastePrefill = useMemo(
    () => prefillBattleConfirmation(paste, database),
    [paste]
  );
  const confirmationValidation = useMemo(
    () =>
      validateBattleConfirmation(
        confirmation,
        database,
        contributionSeason
      ),
    [confirmation, contributionSeason]
  );
  const comparison = useMemo(
    () =>
      confirmationValidation.valid
        ? compareBattleStrength(
            confirmationValidation.battle,
            recommendationData
          )
        : null,
    [confirmationValidation]
  );

  const handleCopy = async () => {
    const copied = await copyToClipboard(prompt);
    setCopyState(copied ? 'copied' : 'failed');
  };

  const handlePasteChange = (text: string) => {
    setPaste(text);
    setServerError(null);
    setSuccess(null);
    if (text.length === 0) return;

    const prefill = prefillBattleConfirmation(text, database);
    if (prefill.parsed) {
      setConfirmation(prefill.confirmation);
      setConfirmationTouched(true);
    }
  };

  const handleConfirmationChange = (next: BattleConfirmation) => {
    setConfirmation(next);
    setConfirmationTouched(true);
    setServerError(null);
    setSuccess(null);
  };

  const handleSubmit = async () => {
    if (!confirmationValidation.valid || !nameValidation.valid || submitting) {
      return;
    }

    setSubmitting(true);
    setServerError(null);
    setSuccess(null);
    saveUploaderName(uploaderName);
    saveContributionSeason(contributionSeason);

    try {
      const submissionId = getPersistentSubmissionId(
        confirmationValidation.battle,
        uploaderName,
        contributionSeason
      );
      const result = await submitBattle({
        submission_id: submissionId,
        uploader_name: uploaderName,
        season: contributionSeason,
        battle: confirmationValidation.battle,
      });
      setSuccess(
        result.duplicates === 1
          ? '感谢提交！这份战报此前已收到，无需重复上传。贡献榜每天更新一次。'
          : '感谢提交！战报已收到。贡献榜每天更新一次，收录后可在战报贡献榜查看。'
      );
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : '提交失败，请稍后重试。'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    confirmationValidation.valid &&
    nameValidation.valid &&
    !submitting &&
    success === null;

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Typography variant="overline" color="error.main">
        社区战报 · 每日汇总
      </Typography>
      <Typography component="h1" variant="h4" gutterBottom>
        上传战报
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 1.5 }}>
        可用 DeepSeek 从截图预填，也可跳过 JSON 直接手动录入；请逐项确认后再提交。
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2.5 }}>
        如果这个工具对你有帮助，欢迎上传至少一份战报。你的每一次分享，都能帮助大家获得更准确的阵容推荐，谢谢你🥹
      </Typography>

      <Alert severity="error" sx={{ mb: 3 }}>
        <Typography fontWeight={800}>
          请不要上传：1. 平局的战报；2. 已经减员的战斗战报。模型暂时无法处理这些情况。
        </Typography>
      </Alert>

      <Stack spacing={3}>
        <Card component="section" aria-labelledby="upload-steps-title">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              id="upload-steps-title"
              component="h2"
              variant="h5"
              gutterBottom
            >
              四步完成上传
            </Typography>
            <Box component="ol" sx={{ my: 0, pl: 3 }}>
              <Typography component="li" sx={{ mb: 0.75 }}>
                截取一张包含双方完整阵容和中央胜负结果的战报截图。
              </Typography>
              <Typography component="li" sx={{ mb: 0.75 }}>
                复制下方提示词，把截图和提示词一起发送给 DeepSeek。
              </Typography>
              <Typography component="li" sx={{ mb: 0.75 }}>
                可只复制 DeepSeek 返回的 JSON 来预填，也可跳过 JSON 手动录入。
              </Typography>
              <Typography component="li">
                选择战报赛季，确认双方全部位置、战法与胜方，再查看当前模型的阵容评分并提交。
              </Typography>
            </Box>
            <Button
              component="a"
              href="https://www.bilibili.com/video/BV1Rt3M6LEdA/"
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              startIcon={<PlayCircleOutlineIcon />}
              sx={{ mt: 2 }}
            >
              观看视频教程（B站）
            </Button>
          </CardContent>
        </Card>

        <Card component="section" aria-labelledby="deepseek-prompt-title">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              id="deepseek-prompt-title"
              component="h2"
              variant="h5"
              gutterBottom
            >
              准备 DeepSeek 提示词
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              将提示词和一张完整战报截图一起发给 DeepSeek。提示词包含横竖屏定位、双方 2×3
              位置、胜方判断和当前完整名称目录。
            </Typography>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              gap={1.5}
              sx={{ mb: 2 }}
            >
              <Button
                variant="outlined"
                startIcon={<ContentCopyOutlinedIcon />}
                onClick={handleCopy}
                aria-describedby="deepseek-copy-status"
              >
                复制 DeepSeek 提示词
              </Button>
              <Typography
                id="deepseek-copy-status"
                role="status"
                aria-live="polite"
                variant="body2"
                color={copyState === 'failed' ? 'error.light' : 'success.light'}
              >
                {copyState === 'copied'
                  ? '已复制，可以前往 DeepSeek 粘贴。'
                  : copyState === 'failed'
                    ? '复制失败，请展开下方提示词预览后全选复制。'
                    : ''}
              </Typography>
            </Stack>
            <ResponsiveDisclosure
              label="完整 DeepSeek 提示词预览"
              collapseOn="all-viewports"
            >
              <TextField
                label="DeepSeek OCR 提示词"
                value={prompt}
                multiline
                minRows={8}
                maxRows={14}
                fullWidth
                slotProps={{ htmlInput: { readOnly: true } }}
              />
            </ResponsiveDisclosure>
          </CardContent>
        </Card>

        <Card component="section" aria-labelledby="paste-battle-title">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              id="paste-battle-title"
              component="h2"
              variant="h5"
              gutterBottom
            >
              填写并确认战报
            </Typography>

            <TextField
              label="贡献榜名字（选填）"
              value={uploaderName}
              onChange={(event) => {
                setUploaderName(event.target.value);
                setServerError(null);
                setSuccess(null);
              }}
              error={!nameValidation.valid}
              helperText={
                nameValidation.valid
                  ? '名字会显示在战报贡献榜，用来感谢你的贡献；留空则匿名提交。'
                  : nameValidation.error
              }
              fullWidth
              sx={{ mb: 2.5 }}
            />

            <FormControl fullWidth sx={{ mb: 2.5 }}>
              <InputLabel id="contribution-season-label">战报赛季</InputLabel>
              <Select
                labelId="contribution-season-label"
                value={contributionSeason}
                label="战报赛季"
                onChange={(event) => {
                  const nextSeason = Number(event.target.value);
                  setContributionSeason(nextSeason);
                  saveContributionSeason(nextSeason);
                  setConfirmationTouched(true);
                  setServerError(null);
                  setSuccess(null);
                }}
              >
                {Array.from(
                  { length: maximumContributionSeason },
                  (_, index) => index + 1
                ).map((season) => (
                  <MenuItem key={season} value={season}>
                    赛季 {season}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="粘贴 DeepSeek 返回的 JSON（可选）"
              value={paste}
              onChange={(event) => handlePasteChange(event.target.value)}
              placeholder='{"1":[...],"2":[...],"winner":"1"}'
              multiline
              minRows={10}
              fullWidth
              error={paste.length > 0 && !pasteValidation.valid}
              helperText={
                paste.length === 0
                  ? '可跳过此项并直接填写下方确认表；粘贴时只使用 JSON，不要包含 ``` 代码围栏或解释文字。'
                  : pasteValidation.valid
                    ? 'JSON 已填入下方确认表，请继续逐项核对。'
                    : pastePrefill.parsed && pastePrefill.recognizedFields > 0
                      ? `${pasteValidation.error} 已尽量将可识别内容填入下方，请补全或修正后再提交。`
                      : pastePrefill.parsed
                        ? `${pasteValidation.error} 未识别到可预填内容，可修正 JSON 或直接在下方手动填写。`
                        : `${pasteValidation.error} 这段 JSON 未导入；可修正或清空后继续手动确认。`
              }
              sx={{ mb: 3 }}
            />

            <Typography component="h3" variant="h6" sx={{ mb: 2 }}>
              手动确认双方阵容
            </Typography>
            <BattleConfirmationForm
              value={confirmation}
              database={database}
              season={contributionSeason}
              onChange={handleConfirmationChange}
            />

            {confirmationTouched && !confirmationValidation.valid && (
              <Alert severity="warning" sx={{ mt: 2.5 }}>
                {confirmationValidation.error}
              </Alert>
            )}

            {confirmationValidation.valid && comparison && (
              <Stack spacing={2.5} sx={{ mt: 3 }}>
                <Alert severity="success">
                  双方阵容已填写完整，可以提交。
                </Alert>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                    gap: 2,
                  }}
                >
                  <BattleLineup
                    team={confirmationValidation.battle['1']}
                    teamNumber="1"
                    winner={confirmationValidation.battle.winner === '1'}
                    score={comparison.team1.rawScore}
                  />
                  <BattleLineup
                    team={confirmationValidation.battle['2']}
                    teamNumber="2"
                    winner={confirmationValidation.battle.winner === '2'}
                    score={comparison.team2.rawScore}
                  />
                </Box>
                <BattleStrengthNotice
                  comparison={comparison}
                />
              </Stack>
            )}

            {serverError && (
              <Alert severity="error" role="alert" sx={{ mt: 2.5 }}>
                {serverError}
              </Alert>
            )}
            {success && (
              <Alert severity="success" role="status" sx={{ mt: 2.5 }}>
                {success}{' '}
                <Button
                  component={RouterLink}
                  to="/contributors"
                  size="small"
                  color="inherit"
                >
                  查看战报贡献榜
                </Button>
              </Alert>
            )}

            <Button
              variant="contained"
              size="large"
              fullWidth
              startIcon={
                submitting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <SendOutlinedIcon />
                )
              }
              disabled={!canSubmit}
              onClick={handleSubmit}
              sx={{ mt: 2.5 }}
            >
              {submitting ? '正在提交…' : '提交战报'}
            </Button>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};

export default Contribute;
