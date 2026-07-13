import { useState } from "react";
import { LockKeyholeIcon } from "lucide-react";
import {
  checkScreenRecordingPermission,
  getScreenRecordingDebugInfo,
  openScreenRecordingSettings,
  probeScreenCapturePermission,
  requestScreenRecordingPermission,
} from "@/services/permissions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

interface Props {
  onGranted: () => void;
  onDismiss: () => void;
}

/**
 * Onboarding banner that guides the user to grant macOS Screen Recording
 * permission, which is required to capture WeChat windows for OCR.
 */
export function PermissionGuide({ onGranted, onDismiss }: Props) {
  const [requesting, setRequesting] = useState(false);
  const [prompted, setPrompted] = useState(false);
  const [debugInfo, setDebugInfo] = useState("");

  const handleRequest = async () => {
    setRequesting(true);
    await requestScreenRecordingPermission();
    const granted = await probeScreenCapturePermission();
    setRequesting(false);
    setPrompted(true);
    if (granted) {
      onGranted();
    }
  };

  const handleProbe = async () => {
    setRequesting(true);
    const info = await getScreenRecordingDebugInfo();
    setDebugInfo(info);
    const granted = await probeScreenCapturePermission();
    setRequesting(false);
    setPrompted(true);
    if (granted) {
      onGranted();
    }
  };

  const handleRecheck = async () => {
    const granted = await checkScreenRecordingPermission();
    if (granted) {
      onGranted();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="permission-card max-w-xl">
        <DialogHeader>
          <div className="permission-icon">
            <LockKeyholeIcon />
          </div>
          <DialogTitle>需要「屏幕录制」权限</DialogTitle>
          <DialogDescription>
            Taskly 需要「屏幕录制 / Screen &amp; System Audio Recording」权限，
            才能截取微信窗口并识别其中的待办事项。所有截图与识别都在本地完成，不会上传。
          </DialogDescription>
        </DialogHeader>

        <ol className="permission-steps">
          <li>点击下方「授予权限」，在弹窗中允许 Taskly</li>
          <li>
            若未弹窗，点击「打开系统设置」，在
            <b>隐私与安全性 → 屏幕录制</b>中勾选 Taskly
          </li>
          <li>
            授权后可能需要<b>重启 Taskly</b>才能生效
          </li>
        </ol>

        {prompted && (
          <Alert>
            <AlertDescription>
              如果仍未生效，请在系统设置中确认已勾选 Taskly，并重启应用。
              {debugInfo ? ` 当前进程信息：${debugInfo}` : ""}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter className="permission-actions">
          <Button type="button" variant="outline" onClick={onDismiss}>
            稍后再说
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={openScreenRecordingSettings}
          >
            打开系统设置
          </Button>
          <Button type="button" variant="outline" onClick={handleRecheck}>
            我已授权，重新检查
          </Button>
          <Button type="button" variant="outline" onClick={handleProbe}>
            触发系统截图检测
          </Button>
          <Button type="button" onClick={handleRequest} disabled={requesting}>
            {requesting && <Spinner data-icon="inline-start" />}
            {requesting ? "请求中..." : "授予权限"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
