import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Stack,
  Divider,
  Snackbar,
  Alert,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const FEISHU_LINK =
  'https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=57bv57fc-c378-4c86-bec6-54048420f3e7';

const INVITE_TEXT = `搬砖哥 邀请你加入飞书群，快点击${FEISHU_LINK}加入吧！`;

const Join = () => {
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INVITE_TEXT);
      setSnackbarOpen(true);
    } catch (err) {
      // Fallback: select-and-copy via a temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = INVITE_TEXT;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setSnackbarOpen(true);
      } catch (e) {
        // ignore
      }
      document.body.removeChild(textarea);
    }
  };

  return (
    <Box sx={{ py: 3 }}>
      <Paper sx={{ p: 4, mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          🤝 加入飞书群
        </Typography>
        <Typography variant="body2" color="text.secondary">
          欢迎加入我们的飞书群一起讨论游戏策略、分享战斗数据。
        </Typography>
      </Paper>

      <Paper sx={{ p: 4, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          邀请信息
        </Typography>
        <Divider sx={{ mb: 2 }} />

        <Typography
          variant="body1"
          sx={{
            p: 2,
            bgcolor: 'grey.100',
            borderRadius: 1,
            mb: 2,
            wordBreak: 'break-all',
          }}
        >
          搬砖哥 邀请你加入飞书群，快点击
          <Box
            component="a"
            href={FEISHU_LINK}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: 'primary.main', mx: 0.5 }}
          >
            {FEISHU_LINK}
          </Box>
          加入吧！
        </Typography>

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Button
            variant="contained"
            color="primary"
            startIcon={<OpenInNewIcon />}
            href={FEISHU_LINK}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开飞书加入
          </Button>
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopy}
          >
            复制邀请信息
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 4 }}>
        <Typography variant="h6" gutterBottom>
          扫码加入
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          使用飞书 App 扫描下方二维码即可加入群聊。
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Box
            component="img"
            src={`${process.env.PUBLIC_URL || ''}/feishu-qr.png`}
            alt="飞书群二维码"
            sx={{
              maxWidth: '100%',
              width: { xs: '100%', sm: 360 },
              height: 'auto',
              borderRadius: 2,
              boxShadow: 3,
            }}
          />
        </Box>
      </Paper>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity="success"
          variant="filled"
          sx={{ width: '100%' }}
        >
          邀请信息已复制到剪贴板
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Join;
