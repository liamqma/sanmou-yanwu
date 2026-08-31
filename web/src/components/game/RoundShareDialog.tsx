import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ShareIcon from '@mui/icons-material/Share';

interface RoundShareDialogProps {
  open: boolean;
  previewUrl: string | null;
  canNativeShare: boolean;
  onClose: () => void;
  onDownload: () => void;
  onNativeShare: () => void;
}

const RoundShareDialog = ({
  open,
  previewUrl,
  canNativeShare,
  onClose,
  onDownload,
  onNativeShare,
}: RoundShareDialogProps) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>发送到微信</DialogTitle>
    <DialogContent>
      <Alert severity="info" sx={{ mb: 2 }}>
        浏览器未允许直接复制图片。可分享或下载图片；在手机上也可以长按预览图保存后发送到微信。
      </Alert>
      {previewUrl && (
        <Box
          component="img"
          src={previewUrl}
          alt="本轮候选组与当前阵容分享图片预览"
          sx={{ display: 'block', width: '100%', height: 'auto', border: '1px solid', borderColor: 'divider' }}
        />
      )}
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap' }}>
      <Button onClick={onClose}>关闭</Button>
      <Button
        variant="outlined"
        startIcon={<DownloadIcon />}
        onClick={onDownload}
        disabled={!previewUrl}
      >
        下载图片
      </Button>
      {canNativeShare && (
        <Button
          variant="contained"
          startIcon={<ShareIcon />}
          onClick={onNativeShare}
        >
          分享图片
        </Button>
      )}
    </DialogActions>
  </Dialog>
);

export default RoundShareDialog;
