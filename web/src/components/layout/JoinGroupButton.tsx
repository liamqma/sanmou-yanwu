import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Alert,
  AlertTitle,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';

/**
 * Button that opens a dialog displaying the author's WeChat QR code so users
 * can request to join the 演武 discussion group.
 *
 * The QR image is served from /wechat-qr.jpg in the public folder. To rotate
 * the QR (e.g. after WeChat → Me → My QR Code → Reset), simply replace the
 * file at web/public/wechat-qr.jpg.
 */
const JoinGroupButton = () => {
  const [open, setOpen] = useState(false);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <>
      <Button
        variant="outlined"
        onClick={handleOpen}
        size="small"
        startIcon={<ForumOutlinedIcon />}
      >
        讨论群
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="xs"
        fullWidth
        aria-labelledby="join-group-dialog-title"
      >
        <DialogTitle id="join-group-dialog-title" sx={{ pr: 6 }}>
          加演武讨论群
          <IconButton
            aria-label="关闭"
            onClick={handleClose}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <Box
              component="img"
              src="/wechat-qr.jpg"
              alt="作者微信二维码"
              sx={{
                width: '100%',
                maxWidth: 280,
                height: 'auto',
                border: '1px solid',
                borderColor: 'divider',
              }}
            />
            <Typography variant="body2" color="text.secondary" align="center">
              扫码添加作者微信，备注 <strong>“演武”</strong>，作者会拉你进群。
            </Typography>

            <Alert
              severity="warning"
              variant="outlined"
              sx={{ width: '100%', alignItems: 'flex-start' }}
            >
              <AlertTitle sx={{ fontWeight: 700 }}>群规</AlertTitle>
              <Box component="ul" sx={{ pl: 2, m: 0 }}>
                <li>只讨论演武，无关消息不回。</li>
                <li>纯个人爱好，非官方、非商业。</li>
                <li>谢绝广告、商业合作、机器人、诈骗。违者移出。</li>
              </Box>
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>关闭</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default JoinGroupButton;
